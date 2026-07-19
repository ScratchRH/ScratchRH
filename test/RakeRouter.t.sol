// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RakeRouter} from "../src/RakeRouter.sol";
import {MockScratchToken} from "./mocks/MockScratchToken.sol";
import {MockScratchConverter} from "./mocks/MockScratchConverter.sol";

contract RakeRouterTest is Test {
    MockScratchToken internal scratchToken;
    MockScratchConverter internal converter;
    RakeRouter internal router;

    address internal recipient = address(0xB055);

    function setUp() public {
        scratchToken = new MockScratchToken();
        converter = new MockScratchConverter(scratchToken);
        router = new RakeRouter(converter, recipient);
    }

    function test_sweep_revertsWithNoBalance() public {
        vm.expectRevert(RakeRouter.NothingToSweep.selector);
        router.sweep();
    }

    function test_sweep_splitsRakeFiftyFiftyToOpsAndBuyback() public {
        vm.deal(address(router), 1 ether);

        (uint256 opsAmount, uint256 scratchOut) = router.sweep();

        assertEq(opsAmount, 0.5 ether);
        assertEq(scratchOut, 0.5 ether);
        assertEq(recipient.balance, 0.5 ether);
        assertEq(scratchToken.balanceOf(recipient), 0.5 ether);
        assertEq(address(router).balance, 0);
    }

    function test_sweep_recipientReceivesBothOpsCashAndScratch() public {
        vm.deal(address(router), 5 ether);
        router.sweep();

        // Same wallet gets the ops-cut ETH AND the bought-back $SCRATCH.
        assertEq(recipient.balance, 2.5 ether);
        assertEq(scratchToken.balanceOf(recipient), 2.5 ether);
    }

    function test_sweep_isPermissionless() public {
        vm.deal(address(router), 1 ether);

        vm.prank(address(0xCAFE));
        router.sweep();

        assertEq(recipient.balance, 0.5 ether);
    }

    function test_sweep_emitsSweptEvent() public {
        vm.deal(address(router), 2 ether);

        vm.expectEmit(true, true, true, true);
        emit RakeRouter.Swept(1 ether, 1 ether, 1 ether);
        router.sweep();
    }

    function test_sweep_handlesConsecutiveSweeps() public {
        vm.deal(address(router), 1 ether);
        router.sweep();

        vm.deal(address(router), 3 ether);
        router.sweep();

        assertEq(recipient.balance, 2 ether);
        assertEq(scratchToken.balanceOf(recipient), 2 ether);
    }
}
