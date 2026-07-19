// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Randomness} from "../src/Randomness.sol";

contract RandomnessTest is Test {
    Randomness internal randomness;
    address internal consumer = address(this);

    function setUp() public {
        randomness = new Randomness(consumer);
    }

    function test_request_setsTargetBlockAheadByRevealDelay() public {
        uint256 targetBlock = randomness.request(1);
        assertEq(targetBlock, block.number + randomness.REVEAL_DELAY());
    }

    function test_request_revertsIfNotConsumer() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(Randomness.NotConsumer.selector);
        randomness.request(1);
    }

    function test_request_revertsOnDuplicateId() public {
        randomness.request(1);
        vm.expectRevert(Randomness.AlreadyRequested.selector);
        randomness.request(1);
    }

    function test_fulfill_revertsBeforeTargetBlock() public {
        randomness.request(1);
        vm.expectRevert(Randomness.NotYetRevealable.selector);
        randomness.fulfill(1);
    }

    function test_fulfill_revertsForUnknownRequest() public {
        vm.expectRevert(Randomness.RequestNotFound.selector);
        randomness.fulfill(1);
    }

    function test_fulfill_succeedsAfterRevealDelay() public {
        randomness.request(1);
        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);

        randomness.fulfill(1);

        (, bool fulfilled) = _requestOf(1);
        assertTrue(fulfilled);
    }

    function test_fulfill_isDeterministicForSameBlockhash() public {
        randomness.request(1);
        randomness.request(2);
        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);

        uint256 word1 = randomness.fulfill(1);
        uint256 word2 = randomness.fulfill(2);
        assertTrue(word1 != word2); // different requestId mixed into the hash
    }

    function test_fulfill_revertsIfAlreadyFulfilled() public {
        randomness.request(1);
        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
        randomness.fulfill(1);

        vm.expectRevert(Randomness.AlreadyFulfilled.selector);
        randomness.fulfill(1);
    }

    function test_fulfill_revertsAfterBlockhashExpires() public {
        randomness.request(1);
        vm.roll(block.number + randomness.REVEAL_DELAY() + 257);

        vm.expectRevert(Randomness.BlockhashExpired.selector);
        randomness.fulfill(1);
    }

    function test_reroll_revertsIfNotExpired() public {
        randomness.request(1);
        vm.expectRevert(Randomness.NotExpired.selector);
        randomness.reroll(1);
    }

    function test_reroll_succeedsAfterExpiry() public {
        randomness.request(1);
        vm.roll(block.number + randomness.REVEAL_DELAY() + 257);
        assertTrue(randomness.isExpired(1));

        uint256 newTarget = randomness.reroll(1);
        assertEq(newTarget, block.number + randomness.REVEAL_DELAY());
        assertFalse(randomness.isExpired(1));

        vm.roll(block.number + randomness.REVEAL_DELAY() + 1);
        randomness.fulfill(1);
        (, bool fulfilled) = _requestOf(1);
        assertTrue(fulfilled);
    }

    function _requestOf(uint256 id) internal view returns (uint64 targetBlock, bool fulfilled) {
        (targetBlock, fulfilled) = randomness.requests(id);
    }
}
