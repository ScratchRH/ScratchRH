// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UniswapV4PrizeConverter} from "../src/UniswapV4PrizeConverter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

contract UniswapV4PrizeConverterTest is Test {
    // sqrtPriceX96 for price = 1 (the standard Uniswap reference value, 2^96).
    // The mock's swap() doesn't actually derive amountOut from this — it only
    // needs to exist so getSlot0()/StateLibrary don't read an empty slot —
    // but it's the realistic value a 1:1-priced pool would actually report.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    MockPoolManager internal poolManager;
    UniswapV4PrizeConverter internal converter;
    MockStockToken internal spy;

    address internal owner = address(0xB055);
    address internal recipient = address(0xCAFE);

    function setUp() public {
        poolManager = new MockPoolManager();
        converter = new UniswapV4PrizeConverter(IPoolManager(address(poolManager)), owner);
        spy = new MockStockToken("Mock SPY", "mSPY");
    }

    function _poolKey(address stockToken, uint24 fee, int24 tickSpacing) internal pure returns (PoolKey memory) {
        // address(0) (ETH) sorts below any real token address, so ETH is
        // always currency0 for these pools — matches the converter's own
        // zeroForOne derivation.
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(stockToken),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });
    }

    function _configurePool() internal {
        vm.prank(owner);
        converter.setPoolConfig(address(spy), 3000, 60, address(0));
        poolManager.setPoolPrice(_poolKey(address(spy), 3000, 60), SQRT_PRICE_1_1);
    }

    function test_convert_swapsEthForStockOneToOneThroughMockPool() public {
        _configurePool();

        uint256 amountOut = converter.convert{value: 1 ether}(address(spy), recipient);

        assertEq(amountOut, 1 ether);
        assertEq(spy.balanceOf(recipient), 1 ether);
        assertEq(address(poolManager).balance, 1 ether);
    }

    function test_convert_forwardsExactAmountForArbitraryValues() public {
        _configurePool();

        uint256 amountOut = converter.convert{value: 0.618 ether}(address(spy), recipient);

        assertEq(amountOut, 0.618 ether);
        assertEq(spy.balanceOf(recipient), 0.618 ether);
    }

    function test_convert_revertsWithNoEthSent() public {
        _configurePool();

        vm.expectRevert(UniswapV4PrizeConverter.NoEthSent.selector);
        converter.convert{value: 0}(address(spy), recipient);
    }

    function test_convert_revertsWhenPoolNotConfigured() public {
        vm.expectRevert(abi.encodeWithSelector(UniswapV4PrizeConverter.PoolNotConfigured.selector, address(spy)));
        converter.convert{value: 1 ether}(address(spy), recipient);
    }

    function test_setPoolConfig_revertsForNonOwner() public {
        vm.expectRevert(UniswapV4PrizeConverter.OwnerOnly.selector);
        converter.setPoolConfig(address(spy), 3000, 60, address(0));
    }

    function test_unlockCallback_revertsWhenNotCalledByPoolManager() public {
        vm.expectRevert(UniswapV4PrizeConverter.NotPoolManager.selector);
        converter.unlockCallback("");
    }

    function test_convert_worksForDifferentStockTokens() public {
        MockStockToken aapl = new MockStockToken("Mock AAPL", "mAAPL");
        vm.startPrank(owner);
        converter.setPoolConfig(address(spy), 3000, 60, address(0));
        converter.setPoolConfig(address(aapl), 500, 10, address(0));
        vm.stopPrank();
        poolManager.setPoolPrice(_poolKey(address(spy), 3000, 60), SQRT_PRICE_1_1);
        poolManager.setPoolPrice(_poolKey(address(aapl), 500, 10), SQRT_PRICE_1_1);

        converter.convert{value: 1 ether}(address(spy), recipient);
        converter.convert{value: 2 ether}(address(aapl), recipient);

        assertEq(spy.balanceOf(recipient), 1 ether);
        assertEq(aapl.balanceOf(recipient), 2 ether);
    }

    function test_convert_revertsOnPartialFillFromSlippageLimit() public {
        _configurePool();
        // Simulate the swap hitting its sqrtPriceLimitX96 before filling the
        // full order — e.g. a thin pool or a sandwich moving the price. Only
        // half the requested ETH gets converted.
        poolManager.setForcePartialFill(true, 0.5 ether);

        vm.expectRevert(UniswapV4PrizeConverter.SlippageExceeded.selector);
        converter.convert{value: 1 ether}(address(spy), recipient);
    }

    function test_convert_revertsOnPartialFillEvenByOneWei() public {
        _configurePool();
        // A one-wei short fill should be just as fatal as a large one — this
        // is an exact-match check, not a tolerance band.
        poolManager.setForcePartialFill(true, 1 ether - 1);

        vm.expectRevert(UniswapV4PrizeConverter.SlippageExceeded.selector);
        converter.convert{value: 1 ether}(address(spy), recipient);
    }

    function test_setMaxSlippageBps_revertsForNonOwner() public {
        vm.expectRevert(UniswapV4PrizeConverter.OwnerOnly.selector);
        converter.setMaxSlippageBps(50);
    }

    function test_setMaxSlippageBps_revertsForZero() public {
        vm.prank(owner);
        vm.expectRevert(UniswapV4PrizeConverter.InvalidSlippageBps.selector);
        converter.setMaxSlippageBps(0);
    }

    function test_setMaxSlippageBps_revertsAboveOnePercent() public {
        vm.prank(owner);
        vm.expectRevert(UniswapV4PrizeConverter.InvalidSlippageBps.selector);
        converter.setMaxSlippageBps(101);
    }

    function test_setMaxSlippageBps_ownerCanTuneWithinBounds() public {
        vm.prank(owner);
        converter.setMaxSlippageBps(50);
        assertEq(converter.maxSlippageBps(), 50);
    }

    function test_convert_defaultMaxSlippageBpsIsFifteen() public view {
        assertEq(converter.maxSlippageBps(), 15);
    }
}
