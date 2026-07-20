// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAlgebraSwapCallback} from "../../src/interfaces/IAlgebraPool.sol";
import {MockERC20} from "./MockERC20.sol";

/// Algebra counterpart to MockUniswapV3Pool — same shape, different view/
/// swap function names (globalState instead of slot0, algebraSwapCallback
/// instead of uniswapV3SwapCallback) matching the real Algebra interface.
/// Swaps 1:1 minus `lastFee` by default, same reasoning as
/// MockUniswapV3Pool's `fee` — a real pool deducts its fee before the curve
/// runs, and PrizeConverter's quote needs a mock that actually does that to
/// catch a fee-blind quote bug.
contract MockAlgebraPool {
    address public immutable token0;
    address public immutable token1;

    uint160 public price;
    uint16 public lastFee;
    bool public forceAmountOut;
    uint256 public forcedAmountOut;

    constructor(address tokenA, address tokenB) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function setPrice(uint160 _price) external {
        price = _price;
    }

    function setLastFee(uint16 _lastFee) external {
        lastFee = _lastFee;
    }

    function setForcedAmountOut(bool enabled, uint256 amount) external {
        forceAmountOut = enabled;
        forcedAmountOut = amount;
    }

    function globalState() external view returns (uint160, int24, uint16, uint8, uint16, bool) {
        return (price, 0, lastFee, 0, 0, true);
    }

    function swap(address recipient, bool zeroToOne, int256 amountRequired, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountRequired > 0, "mock only supports exact-input swaps");
        uint256 amountIn = uint256(amountRequired);
        uint256 amountOut = forceAmountOut ? forcedAmountOut : amountIn - (amountIn * lastFee) / 1_000_000;

        (amount0, amount1) =
            zeroToOne ? (int256(amountIn), -int256(amountOut)) : (-int256(amountOut), int256(amountIn));

        address tokenIn = zeroToOne ? token0 : token1;
        uint256 balBefore = MockERC20(tokenIn).balanceOf(address(this));
        IAlgebraSwapCallback(msg.sender).algebraSwapCallback(amount0, amount1, data);
        require(MockERC20(tokenIn).balanceOf(address(this)) - balBefore == amountIn, "callback underpaid");

        MockERC20(zeroToOne ? token1 : token0).mint(recipient, amountOut);
    }
}
