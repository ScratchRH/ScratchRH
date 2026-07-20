// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal slice of the real AlgebraPool interface (verified against live
/// source on Robinhood Chain, pools 0x5DBEB962FC071137252e013B24E6a3ee35714F2f
/// (WETH/SPY) and 0xBacc7e8808ae4C27DA59A149DfE83fFAF61c3e1a (WETH/PLTR)) —
/// only what PrizeConverter actually calls, not a full reimplementation.
/// Algebra uses `globalState()` where Uniswap V3 uses `slot0()`, and its
/// swap callback is named `algebraSwapCallback`, not `uniswapV3SwapCallback`
/// — confirmed against the real IAlgebraSwapCallback.sol source, not
/// inferred from bytecode.
interface IAlgebraPool {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function globalState()
        external
        view
        returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked);

    function swap(address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

interface IAlgebraSwapCallback {
    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}
