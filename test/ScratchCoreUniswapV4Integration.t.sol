// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Randomness} from "../src/Randomness.sol";
import {ScratchCore} from "../src/ScratchCore.sol";
import {UniswapV4PrizeConverter} from "../src/UniswapV4PrizeConverter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

/// Every test in ScratchCore.t.sol wires ScratchCore up with
/// MockPrizeConverter — a trivial 1:1 mint-on-demand stub — never the real
/// UniswapV4PrizeConverter. That leaves the actual thing a player
/// experiences (buy -> scratch -> real v4 swap -> stock lands in their
/// wallet) completely unexercised as one path: the payment intake and the
/// v4 swap mechanics were each proven correct in isolation, but never
/// together. This file closes that gap, including the failure mode
/// (scratch() reverting mid-payout) that ScratchCore.t.sol's mock can't
/// produce at all, since MockPrizeConverter never fails.
contract ScratchCoreUniswapV4IntegrationTest is Test {
    // Same price = 1 reference used in the converter's own tests.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    MockPoolManager internal poolManager;
    UniswapV4PrizeConverter internal converter;
    MockStockToken internal spy;
    Randomness internal randomness;
    ScratchCore internal core;

    address internal player = address(0xCAFE);
    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);

    function setUp() public {
        poolManager = new MockPoolManager();
        spy = new MockStockToken("Mock SPY", "mSPY");

        converter = new UniswapV4PrizeConverter(IPoolManager(address(poolManager)), owner);
        vm.prank(owner);
        converter.setPoolConfig(address(spy), FEE, TICK_SPACING, address(0));
        poolManager.setPoolPrice(_poolKey(), SQRT_PRICE_1_1);

        ScratchCore.DeckEntry[] memory deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: address(spy), weightBps: 10_000});

        address predictedCore = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        randomness = new Randomness(predictedCore);

        core = new ScratchCore(converter, randomness, rake, address(spy), deck, _defaultCardConfigs(), 1000, owner);
        assertEq(address(core), predictedCore);

        vm.deal(player, 1_000 ether);
    }

    function _defaultCardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2}); // Premium
    }

    function _poolKey() internal view returns (PoolKey memory) {
        // address(0) (ETH) sorts below any real token address.
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(spy)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    function test_buyAndScratch_paysRealStockThroughTheActualV4SwapPath() public {
        vm.prank(player);
        uint256 ticketId = core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
        (ScratchCore.Tier tier, address stockToken, uint256 payout) = core.scratch(ticketId);

        // Floor-or-win are mutually exclusive (scratch()'s `payout` return
        // is only set on a win — floor-only stays 0 by design, matching
        // ScratchCore.t.sol's own test_scratch_paysExactlyOneOfFloorOrWinPayout),
        // but either way *some* real stock — delivered by the real
        // unlock/swap/settle/take sequence, not a mock mint — must have
        // landed in the player's wallet.
        assertEq(stockToken, address(spy));
        assertGt(spy.balanceOf(player), 0);
        if (tier != ScratchCore.Tier.None) assertGt(payout, 0);
    }

    function test_scratch_revertsCleanlyAndStaysRetryableWhenConverterCantFillWithinSlippage() public {
        vm.prank(player);
        uint256 ticketId = core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);
        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);

        // Simulate the real converter's slippage guard tripping — a thin
        // pool or a same-block sandwich, exactly the scenario it exists to
        // catch. The revert must come from inside the real converter, not
        // a test-only shortcut.
        poolManager.setForcePartialFill(true, 0.0001 ether);

        vm.expectRevert(UniswapV4PrizeConverter.SlippageExceeded.selector);
        core.scratch(ticketId);

        // The whole scratch() transaction must have rolled back — not just
        // the payout — leaving the ticket exactly as unscratched as before
        // the failed attempt, so anyone can retry it later.
        (,,, bool scratchedAfterFailure) = core.tickets(ticketId);
        assertFalse(scratchedAfterFailure);

        // Once the pool can fill normally again, the same ticket resolves
        // on retry — proving the failure didn't strand it.
        poolManager.setForcePartialFill(false, 0);
        (ScratchCore.Tier tier, address stockToken, uint256 payout) = core.scratch(ticketId);

        assertEq(stockToken, address(spy));
        if (tier != ScratchCore.Tier.None) assertGt(payout, 0);
        assertGt(spy.balanceOf(player), 0);
        (,,, bool scratchedAfterRetry) = core.tickets(ticketId);
        assertTrue(scratchedAfterRetry);
    }

    function test_scratch_revertsWhenStockTokenHasNoPoolConfigured() public {
        MockStockToken unlisted = new MockStockToken("Mock Unlisted", "mUNL");
        ScratchCore.DeckEntry[] memory deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: address(unlisted), weightBps: 10_000});

        address predictedCore = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        Randomness randomness2 = new Randomness(predictedCore);
        ScratchCore core2 =
            new ScratchCore(converter, randomness2, rake, address(unlisted), deck, _defaultCardConfigs(), 1000, owner);
        assertEq(address(core2), predictedCore);

        vm.deal(player, 1 ether);
        vm.prank(player);
        uint256 ticketId = core2.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);
        vm.roll(block.number + randomness2.REVEAL_DELAY() + 1);

        vm.expectRevert(
            abi.encodeWithSelector(UniswapV4PrizeConverter.PoolNotConfigured.selector, address(unlisted))
        );
        core2.scratch(ticketId);
    }
}
