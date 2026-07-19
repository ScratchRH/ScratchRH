// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// ERC-8056 "Scaled UI Amount" extension used by Robinhood Chain stock tokens
/// (SPEC.md §4). balanceOf is raw; balanceOfUI/uiMultiplier are share-equivalent
/// and reflect corporate actions (splits, reinvested dividends).
interface IStockToken is IERC20 {
    function uiMultiplier() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
}
