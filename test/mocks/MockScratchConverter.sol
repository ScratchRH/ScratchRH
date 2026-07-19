// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IScratchConverter} from "../../src/interfaces/IScratchConverter.sol";
import {MockScratchToken} from "./MockScratchToken.sol";

/// Test double for IScratchConverter: mints `msg.value` of the mock $SCRATCH
/// token 1:1 to `recipient`, standing in for a real DEX swap.
contract MockScratchConverter is IScratchConverter {
    MockScratchToken public immutable scratchToken;

    constructor(MockScratchToken _scratchToken) {
        scratchToken = _scratchToken;
    }

    function convert(address recipient) external payable returns (uint256 amountOut) {
        amountOut = msg.value;
        scratchToken.mint(recipient, amountOut);
    }
}
