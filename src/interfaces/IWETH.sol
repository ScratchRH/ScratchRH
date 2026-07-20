// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// Minimal WETH interface — just the deposit step PrizeConverter needs, on
/// top of standard ERC20, matching the real WETH at
/// 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 that every confirmed route on
/// Robinhood Chain wraps ETH into before the first swap hop.
interface IWETH is IERC20 {
    function deposit() external payable;
}
