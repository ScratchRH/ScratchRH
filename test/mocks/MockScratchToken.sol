// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// Stand-in for the eventual $SCRATCH token in tests.
contract MockScratchToken is MockERC20 {
    constructor() MockERC20("Mock SCRATCH", "mSCRATCH", 18) {}
}
