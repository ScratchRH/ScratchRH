// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";

/// MockERC20 plus a constant ERC-8056 uiMultiplier, standing in for a real
/// Robinhood Chain stock token (SPEC.md §4/§8).
contract MockStockToken is MockERC20, IStockToken {
    constructor(string memory _name, string memory _symbol) MockERC20(_name, _symbol, 18) {}

    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf[account];
    }
}
