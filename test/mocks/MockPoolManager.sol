// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {MockERC20} from "./MockERC20.sol";

/// Test double for the tiny slice of IPoolManager that UniswapV4PrizeConverter
/// actually calls (unlock/swap/sync/settle/take/extsload) — not a full
/// PoolManager reimplementation. Imports the real IPoolManager purely for
/// its nested SwapParams type, so the ABI shape is guaranteed identical to
/// what the real interface expects (no hand-duplicated struct to drift out
/// of sync). Swaps 1:1 by minting the output token on demand, same "no held
/// inventory" simplification MockPrizeConverter uses for the pre-v4
/// IPrizeConverter mock — except when a test arms forcePartialFill, which
/// simulates the swap hitting its sqrtPriceLimitX96 before fully filling.
contract MockPoolManager {
    error SettleAmountMismatch(uint256 expected, uint256 received);

    /// The amount `settle()` should expect payment in, set by the swap
    /// that's currently in flight. Real PoolManager derives this from
    /// `sync()`'s checkpoint; this mock just tracks it directly.
    uint256 private pendingSettleAmount;

    /// Raw slot storage, standing in for the real PoolManager's internal
    /// `mapping(PoolId => Pool.State) pools`. Only slot0 (sqrtPriceX96 in
    /// the bottom 160 bits) is ever populated — nothing here reads tick,
    /// liquidity, or fee state, so those bits are left zero.
    mapping(bytes32 => bytes32) private slots;

    bool public forcePartialFill;
    uint256 public partialFillAmount;

    /// Seeds the price StateLibrary.getSlot0 will read for `key`'s pool, at
    /// the exact storage slot the real library derives — see
    /// StateLibrary._getPoolStateSlot, which this replicates verbatim.
    function setPoolPrice(PoolKey memory key, uint160 sqrtPriceX96) external {
        PoolId id = key.toId();
        bytes32 slot = keccak256(abi.encodePacked(PoolId.unwrap(id), StateLibrary.POOLS_SLOT));
        slots[slot] = bytes32(uint256(sqrtPriceX96));
    }

    /// Arms a simulated partial fill: the next swap() call reports only
    /// `amount` converted regardless of what was requested, mimicking a
    /// swap that hit its sqrtPriceLimitX96 before fully filling the order —
    /// exactly the scenario UniswapV4PrizeConverter's slippage guard exists
    /// to catch.
    function setForcePartialFill(bool enabled, uint256 amount) external {
        forcePartialFill = enabled;
        partialFillAmount = amount;
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return slots[slot];
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory key, IPoolManager.SwapParams memory params, bytes calldata)
        external
        returns (BalanceDelta)
    {
        require(params.amountSpecified < 0, "mock only supports exact-input swaps");
        uint256 requestedIn = uint256(-params.amountSpecified);
        uint256 amountIn = forcePartialFill ? partialFillAmount : requestedIn;
        uint256 amountOut = amountIn; // 1:1, matching MockPrizeConverter's simplification

        pendingSettleAmount = amountIn;
        key; // key isn't needed beyond routing (mock has no per-pool state)

        // safe: test amounts never approach int128's ~1.7e38 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 delta0 = params.zeroForOne ? -int128(int256(amountIn)) : int128(int256(amountOut));
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 delta1 = params.zeroForOne ? int128(int256(amountOut)) : -int128(int256(amountIn));
        return toBalanceDelta(delta0, delta1);
    }

    function sync(Currency) external {}

    function settle() external payable returns (uint256 paid) {
        if (msg.value != pendingSettleAmount) revert SettleAmountMismatch(pendingSettleAmount, msg.value);
        paid = msg.value;
    }

    function take(Currency currency, address to, uint256 amount) external {
        MockERC20(Currency.unwrap(currency)).mint(to, amount);
    }

    receive() external payable {}
}
