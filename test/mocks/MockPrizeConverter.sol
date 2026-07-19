// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPrizeConverter} from "../../src/interfaces/IPrizeConverter.sol";
import {MockERC20} from "./MockERC20.sol";

/// Test double for IPrizeConverter: pays out `msg.value` of the (pre-minted)
/// stock token 1:1, standing in for a real DEX swap (SPEC.md §5, deferred
/// pending pool discovery per SPEC.md §7.2).
contract MockPrizeConverter is IPrizeConverter {
    function convert(address stockToken, address recipient) external payable returns (uint256 amountOut) {
        amountOut = msg.value;
        MockERC20(stockToken).mint(recipient, amountOut);
    }
}
