// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Subset of Chainlink's AggregatorV3Interface. Robinhood Chain stock-token
/// feeds update 24/5 and pause during corporate actions — check
/// IStockToken.oraclePaused() equivalent before trusting a quote (SPEC.md §4).
interface IPriceFeed {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
