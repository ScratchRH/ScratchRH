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

/// Test double for the tiny slice of IPoolManager that PrizeConverter
/// actually calls (unlock/swap/sync/settle/take/extsload) — not a full
/// PoolManager reimplementation. Imports the real IPoolManager purely for
/// its nested SwapParams type, so the ABI shape is guaranteed identical to
/// what the real interface expects. Swaps 1:1 by minting the output token
/// on demand, same "no held inventory" simplification the direct-pool
/// mocks use — except when a test arms forcePartialFill, which simulates a
/// swap that moved past its price bound before fully filling.
///
/// Settlement is ERC20-only: sync() snapshots this contract's balance of
/// the pending currency, settle() reports what actually arrived since. Real
/// PoolManager can also settle native ETH via msg.value, but PrizeConverter
/// never sends native ETH into a V4 hop — msg.value is wrapped to WETH once
/// in convert(), before any hop runs, so every currency a route settles is
/// an ERC20.
contract MockPoolManager {
    Currency private pendingCurrency;
    uint256 private pendingSnapshot;

    /// Raw slot storage, standing in for the real PoolManager's internal
    /// `mapping(PoolId => Pool.State) pools`. Only slot0 (sqrtPriceX96 in
    /// the bottom 160 bits) is ever populated — nothing here reads tick,
    /// liquidity, or fee state, so those bits are left zero.
    mapping(bytes32 => bytes32) private slots;

    bool public forcePartialFill;
    uint256 public partialFillAmount;

    /// Lets a test assert that N consecutive V4 hops shared a single
    /// unlock() session rather than one per hop.
    uint256 public unlockCallCount;

    /// Seeds the price StateLibrary.getSlot0 will read for `key`'s pool, at
    /// the exact storage slot the real library derives — see
    /// StateLibrary._getPoolStateSlot, which this replicates verbatim.
    function setPoolPrice(PoolKey memory key, uint160 sqrtPriceX96) external {
        PoolId id = key.toId();
        bytes32 slot = keccak256(abi.encodePacked(PoolId.unwrap(id), StateLibrary.POOLS_SLOT));
        slots[slot] = bytes32(uint256(sqrtPriceX96));
    }

    /// Arms a simulated underfill: the next swap() call reports only
    /// `amount` converted regardless of what was requested, mimicking a
    /// swap that moved past its price bound before fully filling — exactly
    /// the scenario PrizeConverter's route-level slippage guard exists to
    /// catch.
    function setForcePartialFill(bool enabled, uint256 amount) external {
        forcePartialFill = enabled;
        partialFillAmount = amount;
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return slots[slot];
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        unlockCallCount++;
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory key, IPoolManager.SwapParams memory params, bytes calldata)
        external
        returns (BalanceDelta)
    {
        require(params.amountSpecified < 0, "mock only supports exact-input swaps");
        uint256 requestedIn = uint256(-params.amountSpecified);
        uint256 amountIn = forcePartialFill ? partialFillAmount : requestedIn;
        // 1:1 minus key.fee — a real V4 pool deducts its LP fee from the
        // input before the curve runs, same reasoning as the direct-pool
        // mocks' `fee`/`lastFee` deduction.
        uint256 amountInAfterFee = amountIn - (amountIn * key.fee) / 1_000_000;
        uint256 amountOut = forcePartialFill ? amountIn : amountInAfterFee;

        // safe: test amounts never approach int128's ~1.7e38 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 delta0 = params.zeroForOne ? -int128(int256(amountIn)) : int128(int256(amountOut));
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 delta1 = params.zeroForOne ? int128(int256(amountOut)) : -int128(int256(amountIn));
        return toBalanceDelta(delta0, delta1);
    }

    function sync(Currency currency) external {
        pendingCurrency = currency;
        pendingSnapshot = MockERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    function settle() external payable returns (uint256 paid) {
        paid = MockERC20(Currency.unwrap(pendingCurrency)).balanceOf(address(this)) - pendingSnapshot;
    }

    function take(Currency currency, address to, uint256 amount) external {
        MockERC20(Currency.unwrap(currency)).mint(to, amount);
    }

    receive() external payable {}
}
