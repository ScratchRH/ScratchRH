// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrizeConverter} from "../src/PrizeConverter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {MockWETH} from "./mocks/MockWETH.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUniswapV3Pool} from "./mocks/MockUniswapV3Pool.sol";
import {MockAlgebraPool} from "./mocks/MockAlgebraPool.sol";

/// Covers the three real route shapes confirmed on Robinhood Chain (see
/// PrizeConverter.sol's contract-level doc comment): a single Algebra hop
/// (SPY/PLTR), a V3-then-V4 two-hop (NVDA/MSFT), and a V4-then-V4 two-hop
/// (AAPL) — plus route-level slippage and access control. All three real
/// pool prices are 1:1 by convention in these tests, so any golden-path
/// route should convert `amountIn` to the same `amountOut` regardless of
/// how many hops or which protocols it crosses.
contract PrizeConverterTest is Test {
    // sqrtPriceX96 for price = 1 (2^96) — the standard Uniswap reference
    // value, and also exactly FixedPoint96.Q96, which is what makes the
    // mocks' 1:1 execution match _quoteHop's 1:1 quote in these tests.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    MockPoolManager internal poolManager;
    MockWETH internal weth;
    PrizeConverter internal converter;
    MockERC20 internal spy;

    address internal owner = address(0xB055);
    address internal recipient = address(0xCAFE);

    function setUp() public {
        poolManager = new MockPoolManager();
        weth = new MockWETH();
        converter = new PrizeConverter(IPoolManager(address(poolManager)), IWETH(address(weth)), owner);
        spy = new MockERC20("Mock SPY", "mSPY", 18);
    }

    function _v4Key(address tokenA, address tokenB, uint24 fee, int24 tickSpacing)
        internal
        pure
        returns (PoolKey memory)
    {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });
    }

    function _singleHop(PrizeConverter.Protocol protocol, address pool, address tokenOut, uint24 fee, int24 tickSpacing)
        internal
        pure
        returns (PrizeConverter.Hop[] memory hops)
    {
        hops = new PrizeConverter.Hop[](1);
        hops[0] = PrizeConverter.Hop({
            protocol: protocol,
            pool: pool,
            tokenOut: tokenOut,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: address(0)
        });
    }

    // -------------------------------------------------------------------
    // Single-hop Algebra (SPY/PLTR shape)
    // -------------------------------------------------------------------

    function test_convert_singleAlgebraHop_swapsWethForStock() public {
        MockAlgebraPool pool = new MockAlgebraPool(address(weth), address(spy));
        pool.setPrice(SQRT_PRICE_1_1);

        vm.prank(owner);
        converter.setRoute(address(spy), _singleHop(PrizeConverter.Protocol.Algebra, address(pool), address(spy), 0, 0));

        uint256 amountOut = converter.convert{value: 1 ether}(address(spy), recipient);

        assertEq(amountOut, 1 ether);
        assertEq(spy.balanceOf(recipient), 1 ether);
        assertEq(weth.balanceOf(address(pool)), 1 ether);
    }

    // -------------------------------------------------------------------
    // Two-hop V3 -> V4 (NVDA/MSFT shape)
    // -------------------------------------------------------------------

    function test_convert_v3ThenV4TwoHop_swapsThroughIntermediateToken() public {
        MockERC20 usdg = new MockERC20("Mock USDG", "mUSDG", 18);
        MockERC20 nvda = new MockERC20("Mock NVDA", "mNVDA", 18);

        MockUniswapV3Pool v3Pool = new MockUniswapV3Pool(address(weth), address(usdg));
        v3Pool.setSqrtPriceX96(SQRT_PRICE_1_1);
        poolManager.setPoolPrice(_v4Key(address(usdg), address(nvda), FEE, TICK_SPACING), SQRT_PRICE_1_1);

        PrizeConverter.Hop[] memory hops = new PrizeConverter.Hop[](2);
        hops[0] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V3,
            pool: address(v3Pool),
            tokenOut: address(usdg),
            fee: 0,
            tickSpacing: 0,
            hooks: address(0)
        });
        hops[1] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V4,
            pool: address(0),
            tokenOut: address(nvda),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: address(0)
        });

        vm.prank(owner);
        converter.setRoute(address(nvda), hops);

        uint256 amountOut = converter.convert{value: 1 ether}(address(nvda), recipient);

        // 1 ether * (1 - FEE/1e6) — the V3 leg's mock fee defaults to 0 (not
        // set above), only the V4 leg's FEE=3000 (0.3%) applies.
        assertEq(amountOut, 0.997 ether);
        assertEq(nvda.balanceOf(recipient), 0.997 ether);
        assertEq(usdg.balanceOf(recipient), 0); // intermediate token never leaves the converter
    }

    // -------------------------------------------------------------------
    // Two-hop V4 -> V4 (AAPL shape)
    // -------------------------------------------------------------------

    function test_convert_v4ThenV4TwoHop_batchesIntoOneUnlock() public {
        MockERC20 usdg = new MockERC20("Mock USDG", "mUSDG", 18);
        MockERC20 aapl = new MockERC20("Mock AAPL", "mAAPL", 18);

        poolManager.setPoolPrice(_v4Key(address(weth), address(usdg), FEE, TICK_SPACING), SQRT_PRICE_1_1);
        poolManager.setPoolPrice(_v4Key(address(usdg), address(aapl), 500, 10), SQRT_PRICE_1_1);

        PrizeConverter.Hop[] memory hops = new PrizeConverter.Hop[](2);
        hops[0] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V4,
            pool: address(0),
            tokenOut: address(usdg),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: address(0)
        });
        hops[1] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V4,
            pool: address(0),
            tokenOut: address(aapl),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        vm.prank(owner);
        converter.setRoute(address(aapl), hops);

        uint256 amountOut = converter.convert{value: 1 ether}(address(aapl), recipient);

        // 1 ether * (1 - 3000/1e6) * (1 - 500/1e6) — both V4 legs' fees compound.
        assertEq(amountOut, 0.9965015 ether);
        assertEq(aapl.balanceOf(recipient), 0.9965015 ether);
        assertEq(poolManager.unlockCallCount(), 1);
    }

    // -------------------------------------------------------------------
    // Fee-aware quoting (regression: the real deploy hit this)
    // -------------------------------------------------------------------

    /// Reproduces the real MSFT/PLTR-shape route (0.01% WETH/USDG V3 fee,
    /// 2% USDG/stock V4 fee — the highest fee tier actually deployed) with
    /// the default 15bps maxSlippageBps and NO forced/adversarial price
    /// movement at all. Before _quoteMinAmountOut accounted for hop.fee,
    /// this reverted SlippageExceeded on every single call — the fee-blind
    /// quote assumed ~1 ether out, real execution (correctly) returned
    /// ~2.01% less, and no maxSlippageBps setting could ever bridge that
    /// gap since 2% exceeds even the 1% hard ceiling on maxSlippageBps.
    /// This is exactly what happened on the live deploy's first real
    /// convert() call.
    function test_convert_succeedsWithRealisticTwoPercentFeeRoute() public {
        MockERC20 usdg = new MockERC20("Mock USDG", "mUSDG", 18);
        MockERC20 msft = new MockERC20("Mock MSFT", "mMSFT", 18);

        MockUniswapV3Pool v3Pool = new MockUniswapV3Pool(address(weth), address(usdg));
        v3Pool.setSqrtPriceX96(SQRT_PRICE_1_1);
        v3Pool.setFee(100); // 0.01%, the real WETH/USDG pool's fee
        poolManager.setPoolPrice(_v4Key(address(usdg), address(msft), 20_000, 400), SQRT_PRICE_1_1);

        PrizeConverter.Hop[] memory hops = new PrizeConverter.Hop[](2);
        hops[0] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V3,
            pool: address(v3Pool),
            tokenOut: address(usdg),
            fee: 0,
            tickSpacing: 0,
            hooks: address(0)
        });
        hops[1] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V4,
            pool: address(0),
            tokenOut: address(msft),
            fee: 20_000, // 2%, the real USDG/MSFT pool's fee
            tickSpacing: 400,
            hooks: address(0)
        });

        vm.prank(owner);
        converter.setRoute(address(msft), hops);

        uint256 amountOut = converter.convert{value: 1 ether}(address(msft), recipient);

        // 1 ether * (1 - 100/1e6) * (1 - 20000/1e6)
        assertEq(amountOut, 0.979902 ether);
        assertEq(msft.balanceOf(recipient), 0.979902 ether);
    }

    // -------------------------------------------------------------------
    // Slippage
    // -------------------------------------------------------------------

    function test_convert_revertsWhenRouteOutputUndershootsQuote() public {
        MockAlgebraPool pool = new MockAlgebraPool(address(weth), address(spy));
        pool.setPrice(SQRT_PRICE_1_1);
        // Quote is ~0.9985 ether (default 15bps slippage floor on a 1:1
        // spot price); force real execution to fall short of that.
        pool.setForcedAmountOut(true, 0.99 ether);

        vm.prank(owner);
        converter.setRoute(address(spy), _singleHop(PrizeConverter.Protocol.Algebra, address(pool), address(spy), 0, 0));

        vm.expectRevert(PrizeConverter.SlippageExceeded.selector);
        converter.convert{value: 1 ether}(address(spy), recipient);
    }

    function test_convert_revertsWhenV4HopUnderfills() public {
        poolManager.setPoolPrice(_v4Key(address(weth), address(spy), FEE, TICK_SPACING), SQRT_PRICE_1_1);
        poolManager.setForcePartialFill(true, 0.99 ether);

        PrizeConverter.Hop[] memory hops = new PrizeConverter.Hop[](1);
        hops[0] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V4,
            pool: address(0),
            tokenOut: address(spy),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: address(0)
        });
        vm.prank(owner);
        converter.setRoute(address(spy), hops);

        vm.expectRevert(PrizeConverter.SlippageExceeded.selector);
        converter.convert{value: 1 ether}(address(spy), recipient);
    }

    // -------------------------------------------------------------------
    // Access control / config
    // -------------------------------------------------------------------

    function test_setRoute_revertsForNonOwner() public {
        vm.expectRevert(PrizeConverter.OwnerOnly.selector);
        converter.setRoute(address(spy), _singleHop(PrizeConverter.Protocol.Algebra, address(1), address(spy), 0, 0));
    }

    function test_setRoute_revertsForEmptyHops() public {
        vm.prank(owner);
        vm.expectRevert(PrizeConverter.EmptyRoute.selector);
        converter.setRoute(address(spy), new PrizeConverter.Hop[](0));
    }

    function test_convert_revertsWhenRouteNotConfigured() public {
        vm.expectRevert(abi.encodeWithSelector(PrizeConverter.RouteNotConfigured.selector, address(spy)));
        converter.convert{value: 1 ether}(address(spy), recipient);
    }

    function test_convert_revertsWithNoEthSent() public {
        MockAlgebraPool pool = new MockAlgebraPool(address(weth), address(spy));
        pool.setPrice(SQRT_PRICE_1_1);
        vm.prank(owner);
        converter.setRoute(address(spy), _singleHop(PrizeConverter.Protocol.Algebra, address(pool), address(spy), 0, 0));

        vm.expectRevert(PrizeConverter.NoEthSent.selector);
        converter.convert{value: 0}(address(spy), recipient);
    }

    function test_unlockCallback_revertsWhenNotCalledByPoolManager() public {
        vm.expectRevert(PrizeConverter.NotPoolManager.selector);
        converter.unlockCallback("");
    }

    function test_setMaxSlippageBps_revertsForNonOwner() public {
        vm.expectRevert(PrizeConverter.OwnerOnly.selector);
        converter.setMaxSlippageBps(50);
    }

    function test_setMaxSlippageBps_revertsForZero() public {
        vm.prank(owner);
        vm.expectRevert(PrizeConverter.InvalidSlippageBps.selector);
        converter.setMaxSlippageBps(0);
    }

    function test_setMaxSlippageBps_revertsAboveOnePercent() public {
        vm.prank(owner);
        vm.expectRevert(PrizeConverter.InvalidSlippageBps.selector);
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
