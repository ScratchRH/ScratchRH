// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Converts ticket proceeds (native ETH) into a stock token at scratch/buy
/// time. Real implementation swaps on-chain (Uniswap v4 on Robinhood Chain,
/// SPEC.md §4/§7) — deferred until the SPY/WETH pool is confirmed. Callers
/// send `msg.value` as the swap input.
interface IPrizeConverter {
    function convert(address stockToken, address recipient) external payable returns (uint256 amountOut);
}
