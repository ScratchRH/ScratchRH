// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TokenTaxRouter} from "../src/TokenTaxRouter.sol";
import {ScratchCore} from "../src/ScratchCore.sol";
import {Randomness} from "../src/Randomness.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";
import {MockPrizeConverter} from "./mocks/MockPrizeConverter.sol";

contract TokenTaxRouterTest is Test {
    MockStockToken internal spy;
    MockPrizeConverter internal converter;
    Randomness internal randomness;
    ScratchCore internal core;
    TokenTaxRouter internal router;

    address internal rake = address(0xFEE5);
    address internal owner = address(0xB055);
    address internal opsRecipient = address(0x0FF5);

    function setUp() public {
        spy = new MockStockToken("Mock SPY", "mSPY");
        converter = new MockPrizeConverter();

        address predictedCore = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        randomness = new Randomness(predictedCore);

        ScratchCore.DeckEntry[] memory deck = new ScratchCore.DeckEntry[](1);
        deck[0] = ScratchCore.DeckEntry({token: address(spy), weightBps: 10_000});
        ScratchCore.CardConfig[3] memory cardConfigs;
        cardConfigs[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0});
        cardConfigs[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1});
        cardConfigs[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2});

        core = new ScratchCore(converter, randomness, rake, address(spy), deck, cardConfigs, 1000, owner);
        assertEq(address(core), predictedCore);

        router = new TokenTaxRouter(core, opsRecipient);
    }

    function test_sweep_revertsWithNoBalance() public {
        vm.expectRevert(TokenTaxRouter.NothingToSweep.selector);
        router.sweep();
    }

    function test_sweep_splitsTenNinetyToOpsAndPrizePools() public {
        vm.deal(address(router), 1 ether);

        (uint256 opsAmount, uint256 poolsAmount) = router.sweep();

        assertEq(opsAmount, 0.1 ether);
        assertEq(poolsAmount, 0.9 ether);
        assertEq(opsRecipient.balance, 0.1 ether);
        assertEq(address(router).balance, 0);
    }

    function test_sweep_fundsScratchCorePoolsFiftyFifty() public {
        vm.deal(address(router), 1 ether);
        router.sweep();

        // 0.9 ether to pools, split 50/50 inside ScratchCore.fundPools().
        assertEq(core.instantPool(), 0.45 ether);
        assertEq(core.jackpotPot(), 0.45 ether);
    }

    function test_sweep_isPermissionless() public {
        vm.deal(address(router), 1 ether);

        vm.prank(address(0xCAFE));
        router.sweep();

        assertEq(opsRecipient.balance, 0.1 ether);
        assertEq(core.instantPool(), 0.45 ether);
    }

    function test_sweep_emitsSweptEvent() public {
        vm.deal(address(router), 1 ether);

        vm.expectEmit(true, true, true, true);
        emit TokenTaxRouter.Swept(0.1 ether, 0.9 ether);
        router.sweep();
    }

    function test_sweep_handlesConsecutiveSweeps() public {
        vm.deal(address(router), 1 ether);
        router.sweep();

        vm.deal(address(router), 1 ether);
        router.sweep();

        assertEq(opsRecipient.balance, 0.2 ether);
        assertEq(core.instantPool(), 0.9 ether);
        assertEq(core.jackpotPot(), 0.9 ether);
    }

    function test_sweep_doesNotAffectPreExistingPoolBalancesFromTicketSales() public {
        vm.deal(address(this), 1 ether);
        vm.prank(address(this));
        core.buy{value: 0.005 ether}(ScratchCore.CardType.Classic);

        uint256 instantBeforeSweep = core.instantPool();
        uint256 jackpotBeforeSweep = core.jackpotPot();
        assertGt(instantBeforeSweep, 0);

        vm.deal(address(router), 1 ether);
        router.sweep();

        assertEq(core.instantPool(), instantBeforeSweep + 0.45 ether);
        assertEq(core.jackpotPot(), jackpotBeforeSweep + 0.45 ether);
    }
}
