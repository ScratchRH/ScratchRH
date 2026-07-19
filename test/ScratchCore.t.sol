// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Randomness} from "../src/Randomness.sol";
import {ScratchCore} from "../src/ScratchCore.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";
import {MockPrizeConverter} from "./mocks/MockPrizeConverter.sol";
import {ScratchCoreHarness} from "./harness/ScratchCoreHarness.sol";

contract ScratchCoreTest is Test {
    MockStockToken internal spy;
    MockPrizeConverter internal converter;
    Randomness internal randomness;
    ScratchCore internal core;

    address internal player = address(0xCAFE);
    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);

    uint256 internal constant DAILY_CAP = 1000;

    function _singleTokenDeck(address token) internal pure returns (ScratchCore.DeckEntry[] memory deck) {
        deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: token, weightBps: 10_000});
    }

    /// Same prices/jackpot-entries ScratchCore used to hardcode internally,
    /// now supplied by the constructor's caller instead.
    function _defaultCardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2}); // Premium
    }

    function setUp() public {
        spy = new MockStockToken("Mock SPY", "mSPY");
        converter = new MockPrizeConverter();

        // Randomness must know its consumer address up front; ScratchCore's
        // address is deterministic from this test contract's next nonce.
        address predictedCore = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        randomness = new Randomness(predictedCore);

        core = new ScratchCore(
            converter, randomness, rake, address(spy), _singleTokenDeck(address(spy)), _defaultCardConfigs(), DAILY_CAP, owner
        );
        assertEq(address(core), predictedCore);

        vm.deal(player, 1_000 ether);
    }

    function _buyAndScratch(ScratchCore.CardType cardType)
        internal
        returns (uint256 ticketId, ScratchCore.Tier tier, address stockToken, uint256 payout)
    {
        ScratchCore.CardConfig memory config = _configFor(cardType);
        vm.prank(player);
        ticketId = core.buy{value: config.price}(cardType);

        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
        (tier, stockToken, payout) = core.scratch(ticketId);
    }

    function _configFor(ScratchCore.CardType cardType) internal view returns (ScratchCore.CardConfig memory) {
        (uint128 price, uint8 jackpotEntries) = core.cardConfigs(cardType);
        return ScratchCore.CardConfig({price: price, jackpotEntries: jackpotEntries});
    }

    function _expectedMultiplierBps(ScratchCore.Tier tier) internal view returns (uint256) {
        if (tier == ScratchCore.Tier.OneX) return core.ONE_X_MULTIPLIER_BPS();
        if (tier == ScratchCore.Tier.TwoX) return core.TWO_X_MULTIPLIER_BPS();
        if (tier == ScratchCore.Tier.ThreeX) return core.THREE_X_MULTIPLIER_BPS();
        if (tier == ScratchCore.Tier.FourX) return core.FOUR_X_MULTIPLIER_BPS();
        if (tier == ScratchCore.Tier.FiveX) return core.FIVE_X_MULTIPLIER_BPS();
        if (tier == ScratchCore.Tier.TenX) return core.TEN_X_MULTIPLIER_BPS();
        return 0;
    }

    function test_buy_splitsTicketPriceAcrossPoolsAndRake() public {
        uint256 rakeBefore = rake.balance;

        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        // 0.005 ETH Classic: 0.002 floor (not paid until scratch), 0.002 instant pool, 0.0005 jackpot, 0.0005 rake.
        assertEq(core.instantPool(), 0.002 ether);
        assertEq(core.jackpotPot(), 0.0005 ether);
        assertEq(rake.balance - rakeBefore, 0.0005 ether);
        assertEq(spy.balanceOf(player), 0);
    }

    function test_buy_revertsOnIncorrectPayment() public {
        vm.prank(player);
        vm.expectRevert(ScratchCore.IncorrectPayment.selector);
        core.buy{value: 0.004 ether}(ScratchCore.CardType.Classic);
    }

    function test_scratch_paysExactlyOneOfFloorOrWinPayout() public {
        (, ScratchCore.Tier tier, address stockToken, uint256 payout) = _buyAndScratch(ScratchCore.CardType.Classic);

        assertEq(stockToken, address(spy));
        // A tier/jackpot win replaces the floor entirely; None pays the floor
        // and nothing else (payout is 0 in that branch).
        uint256 expected = tier == ScratchCore.Tier.None ? 0.002 ether : payout;
        assertEq(spy.balanceOf(player), expected);
    }

    function _deploySmallCappedCore() internal returns (ScratchCore small) {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        Randomness r = new Randomness(predicted);
        small = new ScratchCore(
            converter, r, rake, address(spy), _singleTokenDeck(address(spy)), _defaultCardConfigs(), 1, owner
        );
        assertEq(address(small), predicted);
    }

    function test_buy_enforcesDailyCap() public {
        ScratchCore small = _deploySmallCappedCore();

        vm.prank(player);
        small.buy{value: 0.001 ether}(ScratchCore.CardType.Penny);

        vm.prank(player);
        vm.expectRevert(ScratchCore.DailyCapReached.selector);
        small.buy{value: 0.001 ether}(ScratchCore.CardType.Penny);
    }

    function test_buy_dailyCapResetsNextDay() public {
        ScratchCore small = _deploySmallCappedCore();

        vm.prank(player);
        small.buy{value: 0.001 ether}(ScratchCore.CardType.Penny);

        vm.warp(block.timestamp + 1 days);
        vm.prank(player);
        small.buy{value: 0.001 ether}(ScratchCore.CardType.Penny); // does not revert
    }

    function test_constructor_honorsCustomCardConfigs() public {
        // A hypothetical "season 2" lineup, deliberately different from
        // _defaultCardConfigs() in both price and jackpot entries, proving
        // these values genuinely come from the constructor argument now —
        // not still hardcoded internally.
        ScratchCore.CardConfig[3] memory season2;
        season2[0] = ScratchCore.CardConfig({price: 0.002 ether, jackpotEntries: 0}); // Penny
        season2[1] = ScratchCore.CardConfig({price: 0.02 ether, jackpotEntries: 3}); // Classic
        season2[2] = ScratchCore.CardConfig({price: 0.1 ether, jackpotEntries: 5}); // Premium

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        Randomness r = new Randomness(predicted);
        ScratchCore custom =
            new ScratchCore(converter, r, rake, address(spy), _singleTokenDeck(address(spy)), season2, DAILY_CAP, owner);

        (uint128 pennyPrice, uint8 pennyEntries) = custom.cardConfigs(ScratchCore.CardType.Penny);
        (uint128 classicPrice, uint8 classicEntries) = custom.cardConfigs(ScratchCore.CardType.Classic);
        (uint128 premiumPrice, uint8 premiumEntries) = custom.cardConfigs(ScratchCore.CardType.Premium);
        assertEq(pennyPrice, 0.002 ether);
        assertEq(pennyEntries, 0);
        assertEq(classicPrice, 0.02 ether);
        assertEq(classicEntries, 3);
        assertEq(premiumPrice, 0.1 ether);
        assertEq(premiumEntries, 5);

        // buy() actually enforces the new prices, not the old defaults.
        vm.prank(player);
        vm.expectRevert(ScratchCore.IncorrectPayment.selector);
        custom.buy{value: 0.005 ether}(ScratchCore.CardType.Classic); // old Classic price, now wrong

        vm.prank(player);
        uint256 ticketId = custom.buy{value: 0.02 ether}(ScratchCore.CardType.Classic); // new Classic price
        (address ticketPlayer,,,) = custom.tickets(ticketId);
        assertEq(ticketPlayer, player);
    }

    function test_constructor_revertsOnEmptyDeck() public {
        ScratchCore.DeckEntry[] memory emptyDeck = new ScratchCore.DeckEntry[](0);
        vm.expectRevert(ScratchCore.EmptyDeck.selector);
        new ScratchCore(converter, randomness, rake, address(spy), emptyDeck, _defaultCardConfigs(), DAILY_CAP, owner);
    }

    function test_constructor_revertsOnDeckWeightsNotSummingToDenom() public {
        ScratchCore.DeckEntry[] memory badDeck = new ScratchCore.DeckEntry[](1);
        badDeck[0] = ScratchCore.DeckEntry({token: address(spy), weightBps: 9_000});
        vm.expectRevert(ScratchCore.InvalidDeckWeights.selector);
        new ScratchCore(converter, randomness, rake, address(spy), badDeck, _defaultCardConfigs(), DAILY_CAP, owner);
    }

    function test_scratch_revertsForUnknownTicket() public {
        vm.expectRevert(ScratchCore.TicketNotFound.selector);
        core.scratch(999);
    }

    function test_scratch_revertsIfAlreadyScratched() public {
        (uint256 ticketId,,,) = _buyAndScratch(ScratchCore.CardType.Classic);
        vm.expectRevert(ScratchCore.AlreadyScratched.selector);
        core.scratch(ticketId);
    }

    function test_receive_buysCardMatchingExactPrice() public {
        vm.prank(player);
        (bool ok,) = address(core).call{value: 0.005 ether}("");
        assertTrue(ok);

        (address ticketPlayer, ScratchCore.CardType cardType,,) = core.tickets(1);
        assertEq(ticketPlayer, player);
        assertEq(uint256(cardType), uint256(ScratchCore.CardType.Classic));
        assertEq(core.nextTicketId(), 2);
    }

    function test_receive_revertsOnValueNotMatchingAnyCardPrice() public {
        vm.prank(player);
        (bool ok,) = address(core).call{value: 0.0033 ether}("");
        assertFalse(ok);
    }

    function test_receive_enforcesDailyCap() public {
        ScratchCore small = _deploySmallCappedCore();

        vm.prank(player);
        (bool firstOk,) = address(small).call{value: 0.001 ether}("");
        assertTrue(firstOk);

        vm.prank(player);
        (bool secondOk,) = address(small).call{value: 0.001 ether}("");
        assertFalse(secondOk);
    }

    function test_scratch_tierPayoutIsMutuallyExclusiveWithFloor() public {
        // Runs a batch of Classic tickets through the full buy+scratch flow
        // and checks the mutual-exclusivity invariant on every single one: a
        // tier win pays exactly price * multiplier (clamped to the pool if
        // needed), never that plus the floor.
        uint256 price = 0.005 ether;
        uint256 floorAmount = (price * 4000) / 10_000;
        bool sawNone = false;
        bool sawWin = false;

        for (uint256 i = 0; i < 50; i++) {
            vm.prank(player);
            uint256 ticketId = core.buy{value: price}(ScratchCore.CardType.Classic);
            uint256 poolAtScratch = core.instantPool();
            uint256 balBefore = spy.balanceOf(player);

            vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
            (ScratchCore.Tier tier,, uint256 payout) = core.scratch(ticketId);
            uint256 minted = spy.balanceOf(player) - balBefore;

            if (tier == ScratchCore.Tier.None) {
                sawNone = true;
                assertEq(payout, 0);
                assertEq(minted, floorAmount);
            } else if (tier == ScratchCore.Tier.Jackpot) {
                assertEq(minted, payout);
            } else {
                sawWin = true;
                uint256 raw = (price * _expectedMultiplierBps(tier)) / 10_000;
                uint256 expected = raw > poolAtScratch ? poolAtScratch : raw;
                assertEq(payout, expected);
                assertEq(minted, expected);
            }
        }

        assertTrue(sawNone);
        assertTrue(sawWin);
    }

    function test_fundPools_splitsFiftyFifty() public {
        core.fundPools{value: 1 ether}();

        assertEq(core.instantPool(), 0.5 ether);
        assertEq(core.jackpotPot(), 0.5 ether);
    }

    function test_fundPools_isPermissionless() public {
        vm.prank(address(0xCAFE));
        core.fundPools{value: 1 ether}();

        assertEq(core.instantPool(), 0.5 ether);
    }

    function test_fundPools_doesNotLoseAWeiToRoundingOnOddAmounts() public {
        core.fundPools{value: 1 wei}();

        assertEq(core.instantPool() + core.jackpotPot(), 1 wei);
    }

    function test_fundPools_emitsPoolsFundedEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ScratchCore.PoolsFunded(0.5 ether, 0.5 ether);
        core.fundPools{value: 1 ether}();
    }

    function test_fundPools_addsOnTopOfExistingTicketSaleContributions() public {
        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);
        uint256 instantBefore = core.instantPool();
        uint256 jackpotBefore = core.jackpotPot();

        core.fundPools{value: 1 ether}();

        assertEq(core.instantPool(), instantBefore + 0.5 ether);
        assertEq(core.jackpotPot(), jackpotBefore + 0.5 ether);
    }

    function test_fundPools_doesNotCreateATicketOrAffectNextTicketId() public {
        uint256 nextIdBefore = core.nextTicketId();

        core.fundPools{value: 0.005 ether}(); // exactly a Classic card's price, on purpose

        assertEq(core.nextTicketId(), nextIdBefore); // no phantom ticket minted
    }
}

contract ScratchCorePayoutTest is Test {
    MockStockToken internal spy;
    MockPrizeConverter internal converter;
    Randomness internal randomness;
    ScratchCoreHarness internal harness;

    address internal player = address(0xCAFE);
    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);

    function _singleTokenDeck(address token) internal pure returns (ScratchCore.DeckEntry[] memory deck) {
        deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: token, weightBps: 10_000});
    }

    function _defaultCardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2}); // Premium
    }

    function setUp() public {
        spy = new MockStockToken("Mock SPY", "mSPY");
        converter = new MockPrizeConverter();

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        randomness = new Randomness(predicted);
        harness = new ScratchCoreHarness(
            converter, randomness, rake, address(spy), _singleTokenDeck(address(spy)), _defaultCardConfigs(), 1000, owner
        );
        assertEq(address(harness), predicted);

        vm.deal(player, 1_000 ether);
    }

    function test_payInstant_paysFlatMultipleOfPrice() public {
        // Fund the instant pool generously (3x 0.01 ether Premium buys -> 0.012
        // ether into the pool) so this payout isn't clamped.
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(player);
            harness.buy{value: 0.01 ether}(ScratchCore.CardType.Premium);
        }

        uint256 price = 0.005 ether; // Classic price
        uint256 amount = harness.payInstant(ScratchCore.Tier.TwoX, price, player, address(spy));

        assertEq(amount, price * 2);
        assertEq(spy.balanceOf(player), price * 2);
    }

    function test_payInstant_clampsToAvailablePoolBalance() public {
        // Fund a small pool via a single Penny buy (0.001 ether * 40% = 0.0004 ether).
        vm.prank(player);
        harness.buy{value: 0.001 ether}(ScratchCore.CardType.Penny);
        uint256 poolBefore = harness.instantPool();

        // TenX on a Premium-priced ticket would owe 0.1 ether, far more than the pool holds.
        uint256 amount = harness.payInstant(ScratchCore.Tier.TenX, 0.01 ether, player, address(spy));

        assertEq(amount, poolBefore);
        assertEq(harness.instantPool(), 0);
        assertEq(spy.balanceOf(player), poolBefore);
    }
}

contract ScratchCoreMysteryPackTest is Test {
    MockStockToken internal spy;
    MockStockToken internal nvda;
    MockStockToken internal tsla;
    MockPrizeConverter internal converter;
    Randomness internal randomness;
    ScratchCore internal core;

    address internal player = address(0xCAFE);
    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);

    // 70% SPY / 25% NVDA / 5% TSLA, matching the mystery-pack odds discussed for launch.
    function _threeTokenDeck() internal view returns (ScratchCore.DeckEntry[] memory deck) {
        deck = new ScratchCore.DeckEntry[](3);
        deck[0] = ScratchCore.DeckEntry({token: address(spy), weightBps: 7_000});
        deck[1] = ScratchCore.DeckEntry({token: address(nvda), weightBps: 2_500});
        deck[2] = ScratchCore.DeckEntry({token: address(tsla), weightBps: 500});
    }

    function _defaultCardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2}); // Premium
    }

    function setUp() public {
        spy = new MockStockToken("Mock SPY", "mSPY");
        nvda = new MockStockToken("Mock NVDA", "mNVDA");
        tsla = new MockStockToken("Mock TSLA", "mTSLA");
        converter = new MockPrizeConverter();

        address predictedCore = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        randomness = new Randomness(predictedCore);
        core = new ScratchCore(
            converter, randomness, rake, address(spy), _threeTokenDeck(), _defaultCardConfigs(), 1000, owner
        );
        assertEq(address(core), predictedCore);

        vm.deal(player, 1_000 ether);
    }

    function test_pullStock_respectsCumulativeWeightBoundaries() public {
        ScratchCoreHarness harness = new ScratchCoreHarness(
            converter, randomness, rake, address(spy), _threeTokenDeck(), _defaultCardConfigs(), 1000, owner
        );

        // roll lands in the "stock pull" slice at (randomWord / 10_000) % 10_000.
        assertEq(harness.pullStock(0), address(spy)); // roll 0 -> within SPY's 0..6999
        assertEq(harness.pullStock(6_999 * 10_000), address(spy));
        assertEq(harness.pullStock(7_000 * 10_000), address(nvda)); // NVDA's 7000..9499
        assertEq(harness.pullStock(9_499 * 10_000), address(nvda));
        assertEq(harness.pullStock(9_500 * 10_000), address(tsla)); // TSLA's 9500..9999
        assertEq(harness.pullStock(9_999 * 10_000), address(tsla));
    }

    function test_scratch_paysExactlyOneOfFloorOrPayoutInCorrectStock() public {
        vm.prank(player);
        uint256 ticketId = core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
        (ScratchCore.Tier tier, address stockToken, uint256 payout) = core.scratch(ticketId);

        assertTrue(stockToken == address(spy) || stockToken == address(nvda) || stockToken == address(tsla));

        // A None ticket pays only the floor, in the pulled stock. A tier win
        // pays only the multiplier payout, also in the pulled stock. A
        // jackpot win pays only the jackpot payout, always in jackpotStockToken
        // (SPY) regardless of the ticket's mystery pull.
        address jackpotToken = core.jackpotStockToken();
        bool jackpotHit = tier == ScratchCore.Tier.Jackpot;
        bool none = tier == ScratchCore.Tier.None;

        uint256 pulledStockExpected = none ? 0.002 ether : (jackpotHit ? 0 : payout);
        uint256 jackpotStockExpected = jackpotHit ? payout : 0;

        if (stockToken == jackpotToken) {
            assertEq(MockStockToken(stockToken).balanceOf(player), pulledStockExpected + jackpotStockExpected);
        } else {
            assertEq(MockStockToken(stockToken).balanceOf(player), pulledStockExpected);
            assertEq(MockStockToken(jackpotToken).balanceOf(player), jackpotStockExpected);
        }

        uint256 totalMinted = spy.balanceOf(player) + nvda.balanceOf(player) + tsla.balanceOf(player);
        assertEq(totalMinted, none ? 0.002 ether : payout);
    }

    function test_jackpot_alwaysPaysInJackpotStockRegardlessOfPull() public view {
        // Jackpot payouts must always settle in the constructor's designated
        // jackpotStockToken (SPY here), never the ticket's mystery pull.
        assertEq(core.jackpotStockToken(), address(spy));
    }
}

contract ScratchCoreTierResolutionTest is Test {
    ScratchCoreHarness internal harness;

    function setUp() public {
        MockPrizeConverter converter = new MockPrizeConverter();
        Randomness randomness = new Randomness(address(0));
        ScratchCore.DeckEntry[] memory deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: address(0xC0FFEE), weightBps: 10_000});
        ScratchCore.CardConfig[3] memory cardConfigs;
        cardConfigs[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0});
        cardConfigs[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1});
        cardConfigs[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2});
        harness = new ScratchCoreHarness(
            converter, randomness, address(0xFEE5), address(0xC0FFEE), deck, cardConfigs, 1000, address(0xB055)
        );
    }

    function test_resolveTier_jackpotEligible_boundaries() public view {
        // Classic (1 jackpot entry): threshold order is
        // Jackpot(1) < TenX(11) < FiveX(51) < FourX(171) < ThreeX(521) < TwoX(1221) < OneX(2621).
        assertEq(uint256(harness.resolveTier(0, 1)), uint256(ScratchCore.Tier.Jackpot));
        assertEq(uint256(harness.resolveTier(1, 1)), uint256(ScratchCore.Tier.TenX));
        assertEq(uint256(harness.resolveTier(10, 1)), uint256(ScratchCore.Tier.TenX));
        assertEq(uint256(harness.resolveTier(11, 1)), uint256(ScratchCore.Tier.FiveX));
        assertEq(uint256(harness.resolveTier(50, 1)), uint256(ScratchCore.Tier.FiveX));
        assertEq(uint256(harness.resolveTier(51, 1)), uint256(ScratchCore.Tier.FourX));
        assertEq(uint256(harness.resolveTier(170, 1)), uint256(ScratchCore.Tier.FourX));
        assertEq(uint256(harness.resolveTier(171, 1)), uint256(ScratchCore.Tier.ThreeX));
        assertEq(uint256(harness.resolveTier(520, 1)), uint256(ScratchCore.Tier.ThreeX));
        assertEq(uint256(harness.resolveTier(521, 1)), uint256(ScratchCore.Tier.TwoX));
        assertEq(uint256(harness.resolveTier(1220, 1)), uint256(ScratchCore.Tier.TwoX));
        assertEq(uint256(harness.resolveTier(1221, 1)), uint256(ScratchCore.Tier.OneX));
        assertEq(uint256(harness.resolveTier(2620, 1)), uint256(ScratchCore.Tier.OneX));
        assertEq(uint256(harness.resolveTier(2621, 1)), uint256(ScratchCore.Tier.None));
        assertEq(uint256(harness.resolveTier(9999, 1)), uint256(ScratchCore.Tier.None));
    }

    function test_resolveTier_notJackpotEligible_neverReturnsJackpot() public view {
        assertEq(uint256(harness.resolveTier(0, 0)), uint256(ScratchCore.Tier.TenX));
    }

    function test_resolveTier_premiumHasTwoJackpotEntries() public view {
        // Premium: 2 jackpot entries -> jackpot threshold widens to rolls 0..1, TenX starts at 2.
        assertEq(uint256(harness.resolveTier(1, 2)), uint256(ScratchCore.Tier.Jackpot));
        assertEq(uint256(harness.resolveTier(2, 2)), uint256(ScratchCore.Tier.TenX));
    }
}

contract ScratchCoreWithdrawTest is Test {
    MockStockToken internal spy;
    MockPrizeConverter internal converter;
    Randomness internal randomness;
    ScratchCore internal core;

    address internal player = address(0xCAFE);
    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);

    uint256 internal constant DAILY_CAP = 1000;

    function _singleTokenDeck(address token) internal pure returns (ScratchCore.DeckEntry[] memory deck) {
        deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: token, weightBps: 10_000});
    }

    function _defaultCardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2}); // Premium
    }

    function setUp() public {
        spy = new MockStockToken("Mock SPY", "mSPY");
        converter = new MockPrizeConverter();

        address predictedCore = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        randomness = new Randomness(predictedCore);

        core = new ScratchCore(
            converter, randomness, rake, address(spy), _singleTokenDeck(address(spy)), _defaultCardConfigs(), DAILY_CAP, owner
        );
        assertEq(address(core), predictedCore);

        vm.deal(player, 1_000 ether);
    }

    function test_withdraw_revertsIfNotOwner() public {
        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() + 1);
        vm.prank(player);
        vm.expectRevert(ScratchCore.NotOwner.selector);
        core.withdraw();
    }

    function test_withdraw_revertsBeforeInactivityPeriodElapses() public {
        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() - 1);
        vm.prank(owner);
        vm.expectRevert(ScratchCore.StillActive.selector);
        core.withdraw();
    }

    function test_withdraw_revertsImmediatelyAfterDeployWithNoPurchases() public {
        // lastPurchaseTimestamp seeds to deploy time, so the clock is already
        // ticking even with zero tickets sold.
        vm.prank(owner);
        vm.expectRevert(ScratchCore.StillActive.selector);
        core.withdraw();
    }

    function test_withdraw_succeedsAfterInactivityPeriodWithNoPurchases() public {
        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() + 1);

        vm.prank(owner);
        uint256 amount = core.withdraw();

        assertEq(amount, 0);
        assertEq(core.instantPool(), 0);
        assertEq(core.jackpotPot(), 0);
    }

    function test_withdraw_sweepsFullBalanceAndZeroesPools() public {
        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        // 0.005 ETH Classic: 0.002 floor stays unpaid until scratch, 0.002 instant pool,
        // 0.0005 jackpot, 0.0005 rake -> 0.0045 ETH sits in the contract.
        uint256 contractBalance = address(core).balance;
        assertEq(contractBalance, 0.0045 ether);

        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() + 1);

        vm.prank(owner);
        uint256 amount = core.withdraw();

        assertEq(amount, contractBalance);
        assertEq(owner.balance, contractBalance);
        assertEq(core.instantPool(), 0);
        assertEq(core.jackpotPot(), 0);
        assertEq(address(core).balance, 0);
    }

    function test_withdraw_buyResetsInactivityClock() public {
        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() - 1);

        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic); // resets lastPurchaseTimestamp

        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() - 1);
        vm.prank(owner);
        vm.expectRevert(ScratchCore.StillActive.selector);
        core.withdraw();
    }

    function test_withdraw_emitsWithdrawnEvent() public {
        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);
        uint256 contractBalance = address(core).balance;

        vm.warp(block.timestamp + core.WITHDRAW_INACTIVITY_PERIOD() + 1);

        vm.expectEmit(true, false, false, true);
        emit ScratchCore.Withdrawn(owner, contractBalance);
        vm.prank(owner);
        core.withdraw();
    }

    function test_setDailyCap_revertsForNonOwner() public {
        vm.prank(player);
        vm.expectRevert(ScratchCore.NotOwner.selector);
        core.setDailyCap(5000);
    }

    function test_setDailyCap_ownerCanRaiseOrLowerIt() public {
        vm.prank(owner);
        core.setDailyCap(5000);
        assertEq(core.dailyCap(), 5000);

        vm.prank(owner);
        core.setDailyCap(1);
        assertEq(core.dailyCap(), 1);
    }

    function test_setDailyCap_emitsDailyCapUpdatedEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ScratchCore.DailyCapUpdated(DAILY_CAP, 42);
        vm.prank(owner);
        core.setDailyCap(42);
    }

    function test_setDailyCap_loweringToAlreadySoldAmountBlocksFurtherPurchasesSameDay() public {
        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);
        assertEq(core.cardsSoldToday(), 1);

        // Lower the cap to exactly what's already sold today.
        vm.prank(owner);
        core.setDailyCap(1);

        vm.prank(player);
        vm.expectRevert(ScratchCore.DailyCapReached.selector);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        // Raising it again immediately unblocks purchases — no need to wait for the next day.
        vm.prank(owner);
        core.setDailyCap(2);
        vm.prank(player);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic); // does not revert
    }

    function test_setDailyCap_settingToZeroActsAsADeFactoPause() public {
        vm.prank(owner);
        core.setDailyCap(0);

        vm.prank(player);
        vm.expectRevert(ScratchCore.DailyCapReached.selector);
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);
    }
}
