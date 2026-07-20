// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal slice of the real UniswapV3Pool interface (verified against live
/// source on Robinhood Chain, pool 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca,
/// the WETH/USDG pool NVDA and MSFT route through) — only what PrizeConverter
/// actually calls, not a full reimplementation.
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// Real signature is `uniswapV3SwapCallback(int256,int256,bytes)` — the pool
/// calls this back on msg.sender mid-swap to collect payment.
interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}
