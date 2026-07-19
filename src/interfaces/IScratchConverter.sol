// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Converts native ETH rake into $SCRATCH at buyback time. Real
/// implementation swaps on-chain once $SCRATCH is launched (SPEC.md §3) —
/// deferred the same way IPrizeConverter's stock swap is (SPEC.md §7.2).
/// Callers send `msg.value` as the swap input.
interface IScratchConverter {
    function convert(address recipient) external payable returns (uint256 amountOut);
}
