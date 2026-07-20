// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3SwapCallback} from "../../src/interfaces/IUniswapV3Pool.sol";
import {MockERC20} from "./MockERC20.sol";

/// Test double for the slice of IUniswapV3Pool PrizeConverter actually
/// calls: token0/token1, fee, slot0 (read for quoting), and swap (real
/// callback round-trip, not a mint-on-demand shortcut) — so tests exercise
/// the real uniswapV3SwapCallback settlement path, not a bypass of it.
/// Swaps 1:1 minus `fee` by default (matching a real pool deducting its fee
/// from the input before the curve runs) — see PrizeConverter's
/// _quoteMinAmountOut doc comment for why the mock needs to actually apply
/// the fee rather than ignore it like an earlier version of this mock did.
/// A test can still force a different output on top of that, to simulate a
/// route-level slippage failure beyond the fee itself.
contract MockUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;

    uint160 public sqrtPriceX96;
    uint24 public fee;
    bool public forceAmountOut;
    uint256 public forcedAmountOut;

    constructor(address tokenA, address tokenB) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function setSqrtPriceX96(uint160 price) external {
        sqrtPriceX96 = price;
    }

    function setFee(uint24 _fee) external {
        fee = _fee;
    }

    function setForcedAmountOut(bool enabled, uint256 amount) external {
        forceAmountOut = enabled;
        forcedAmountOut = amount;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "mock only supports exact-input swaps");
        uint256 amountIn = uint256(amountSpecified);
        uint256 amountOut = forceAmountOut ? forcedAmountOut : amountIn - (amountIn * fee) / 1_000_000;

        (amount0, amount1) =
            zeroForOne ? (int256(amountIn), -int256(amountOut)) : (-int256(amountOut), int256(amountIn));

        address tokenIn = zeroForOne ? token0 : token1;
        uint256 balBefore = MockERC20(tokenIn).balanceOf(address(this));
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(MockERC20(tokenIn).balanceOf(address(this)) - balBefore == amountIn, "callback underpaid");

        MockERC20(zeroForOne ? token1 : token0).mint(recipient, amountOut);
    }
}
