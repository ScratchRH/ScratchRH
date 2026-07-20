// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// MockERC20 plus the one extra entry point PrizeConverter needs — wrapping
/// native ETH 1:1 into the token itself, matching the real WETH every
/// confirmed route wraps into before its first hop.
contract MockWETH is MockERC20 {
    constructor() MockERC20("Mock WETH", "mWETH", 18) {}

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }
}
