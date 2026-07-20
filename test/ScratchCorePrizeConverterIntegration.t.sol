// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Randomness} from "../src/Randomness.sol";
import {ScratchCore} from "../src/ScratchCore.sol";
import {PrizeConverter} from "../src/PrizeConverter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {MockWETH} from "./mocks/MockWETH.sol";
import {MockAlgebraPool} from "./mocks/MockAlgebraPool.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

/// Every test in ScratchCore.t.sol wires ScratchCore up with
/// MockPrizeConverter — a trivial 1:1 mint-on-demand stub — never the real
/// PrizeConverter. That leaves the actual thing a player experiences (buy ->
/// scratch -> real swap -> stock lands in their wallet) completely
/// unexercised as one path: the payment intake and the swap mechanics were
/// each proven correct in isolation (ScratchCore.t.sol, PrizeConverter.t.sol
/// respectively), but never together. This file closes that gap, including
/// the failure mode (scratch() reverting mid-payout) that ScratchCore.t.sol's
/// mock can't produce at all, since MockPrizeConverter never fails.
///
/// Uses a single Algebra hop (the SPY/PLTR real-route shape) rather than the
/// full WETH->USDG->stock chain every real route on Robinhood Chain actually
/// uses — PrizeConverter.t.sol already covers the multi-hop mechanics in
/// isolation; what's missing and worth proving here is specifically that
/// ScratchCore drives PrizeConverter correctly end-to-end, which doesn't
/// depend on how many hops the configured route happens to have.
contract ScratchCorePrizeConverterIntegrationTest is Test {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    MockPoolManager internal poolManager;
    MockWETH internal weth;
    PrizeConverter internal converter;
    MockAlgebraPool internal algebraPool;
    MockStockToken internal spy;
    Randomness internal randomness;
    ScratchCore internal core;

    address internal player = address(0xCAFE);
    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);

    function setUp() public {
        poolManager = new MockPoolManager();
        weth = new MockWETH();
        spy = new MockStockToken("Mock SPY", "mSPY");

        converter = new PrizeConverter(IPoolManager(address(poolManager)), IWETH(address(weth)), owner);
        algebraPool = new MockAlgebraPool(address(weth), address(spy));
        algebraPool.setPrice(SQRT_PRICE_1_1);

        PrizeConverter.Hop[] memory hops = new PrizeConverter.Hop[](1);
        hops[0] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.Algebra,
            pool: address(algebraPool),
            tokenOut: address(spy),
            fee: 0,
            tickSpacing: 0,
            hooks: address(0)
        });
        vm.prank(owner);
        converter.setRoute(address(spy), hops);

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

    function test_buyAndScratch_paysRealStockThroughTheActualSwapPath() public {
        vm.prank(player);
        uint256 ticketId = core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
        (ScratchCore.Tier tier, address stockToken, uint256 payout) = core.scratch(ticketId);

        // Floor-or-win are mutually exclusive (scratch()'s `payout` return
        // is only set on a win — floor-only stays 0 by design, matching
        // ScratchCore.t.sol's own test_scratch_paysExactlyOneOfFloorOrWinPayout),
        // but either way *some* real stock — delivered by the real
        // wrap/swap/settle sequence, not a mock mint — must have landed in
        // the player's wallet.
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
        algebraPool.setForcedAmountOut(true, 0.0001 ether);

        vm.expectRevert(PrizeConverter.SlippageExceeded.selector);
        core.scratch(ticketId);

        // The whole scratch() transaction must have rolled back — not just
        // the payout — leaving the ticket exactly as unscratched as before
        // the failed attempt, so anyone can retry it later.
        (,,, bool scratchedAfterFailure) = core.tickets(ticketId);
        assertFalse(scratchedAfterFailure);

        // Once the pool can fill normally again, the same ticket resolves
        // on retry — proving the failure didn't strand it.
        algebraPool.setForcedAmountOut(false, 0);
        (ScratchCore.Tier tier, address stockToken, uint256 payout) = core.scratch(ticketId);

        assertEq(stockToken, address(spy));
        if (tier != ScratchCore.Tier.None) assertGt(payout, 0);
        assertGt(spy.balanceOf(player), 0);
        (,,, bool scratchedAfterRetry) = core.tickets(ticketId);
        assertTrue(scratchedAfterRetry);
    }

    function test_scratch_revertsWhenStockTokenHasNoRouteConfigured() public {
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

        vm.expectRevert(abi.encodeWithSelector(PrizeConverter.RouteNotConfigured.selector, address(unlisted)));
        core2.scratch(ticketId);
    }
}
