// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPrizeConverter} from "./interfaces/IPrizeConverter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

/// Real IPrizeConverter implementation: swaps native ETH into a stock token
/// via a Uniswap v4 pool, in the same transaction, with no held inventory —
/// same unlock/swap/settle/take shape as rippacks' PacksVault, adapted for a
/// native-ETH input leg instead of an ERC20. v4 pools can hold native ETH
/// directly as Currency(address(0)), so no WETH wrapping step is needed.
///
/// One pool per stock token, configured by `owner` after deploy (SPEC.md
/// §4/§7 — deferred until the SPY/WETH-equivalent pool is confirmed on
/// Robinhood Chain). `fee`/`tickSpacing`/`hooks` must match the live pool
/// exactly or `swap` reverts against the wrong pool.
///
/// Verified against the real lib/v4-core (v4.0.0) interfaces — see git
/// history for the earlier draft that declared these types from memory.
///
/// Slippage: bounds sqrtPriceLimitX96 to within `maxSlippageBps` of the
/// pool's own current price (read via StateLibrary immediately before the
/// swap) rather than accepting any price. This is a real, meaningful cap on
/// per-transaction value loss — nobody can move the price more than
/// maxSlippageBps against a single prize payout, in a thin pool or a
/// sandwich, without the swap partially filling and this contract reverting
/// (see the fill-check in unlockCallback). It is NOT a defense against an
/// attacker who has already manipulated the pool's price *before* this
/// transaction reads it — that requires an external price reference this
/// contract doesn't have. Revisit if/when one becomes available.
contract UniswapV4PrizeConverter is IPrizeConverter, IUnlockCallback {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    address public immutable owner;

    /// Max allowed price movement per swap, in bps out of 20,000 (halved
    /// because a price-space bound of X% corresponds to roughly an X/2%
    /// bound in sqrt-price space — see _slippageBound). Default 15 = 0.15%,
    /// the upper end of the 0.1–0.15% target range: tight enough to cap
    /// value loss per payout, loose enough that ordinary one-block price
    /// drift doesn't cause spurious reverts.
    uint16 public maxSlippageBps = 15;

    struct PoolConfig {
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        bool set;
    }

    mapping(address stockToken => PoolConfig) public poolConfigs;

    struct SwapJob {
        address stockToken;
        address recipient;
        uint256 amountIn;
    }

    error OwnerOnly();
    error PoolNotConfigured(address stockToken);
    error NotPoolManager();
    error NoEthSent();
    error InvalidSlippageBps();
    error SlippageExceeded();

    constructor(IPoolManager _poolManager, address _owner) {
        poolManager = _poolManager;
        owner = _owner;
    }

    /// Deployer-configured per stock token once its real pool exists. Not
    /// callable by scratch()/sweep() callers, only by `owner`.
    function setPoolConfig(address stockToken, uint24 fee, int24 tickSpacing, address hooks) external {
        if (msg.sender != owner) revert OwnerOnly();
        poolConfigs[stockToken] = PoolConfig({fee: fee, tickSpacing: tickSpacing, hooks: hooks, set: true});
    }

    /// Bounded to [1, 100] bps (0.01%–1%) so a mistaken or malicious owner
    /// can't set this to something that provides no real protection.
    function setMaxSlippageBps(uint16 bps) external {
        if (msg.sender != owner) revert OwnerOnly();
        if (bps == 0 || bps > 100) revert InvalidSlippageBps();
        maxSlippageBps = bps;
    }

    function convert(address stockToken, address recipient) external payable returns (uint256 amountOut) {
        if (msg.value == 0) revert NoEthSent();
        if (!poolConfigs[stockToken].set) revert PoolNotConfigured(stockToken);

        bytes memory result = poolManager.unlock(
            abi.encode(SwapJob({stockToken: stockToken, recipient: recipient, amountIn: msg.value}))
        );
        amountOut = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        SwapJob memory job = abi.decode(data, (SwapJob));
        PoolConfig memory cfg = poolConfigs[job.stockToken];

        Currency ethCurrency = CurrencyLibrary.ADDRESS_ZERO;
        Currency stockCurrency = Currency.wrap(job.stockToken);
        bool zeroForOne = ethCurrency < stockCurrency;

        PoolKey memory key = zeroForOne
            ? PoolKey({
                currency0: ethCurrency,
                currency1: stockCurrency,
                fee: cfg.fee,
                tickSpacing: cfg.tickSpacing,
                hooks: IHooks(cfg.hooks)
            })
            : PoolKey({
                currency0: stockCurrency,
                currency1: ethCurrency,
                fee: cfg.fee,
                tickSpacing: cfg.tickSpacing,
                hooks: IHooks(cfg.hooks)
            });

        (uint160 sqrtPriceCurrent,,,) = poolManager.getSlot0(key.toId());
        uint160 sqrtPriceLimit = _slippageBound(sqrtPriceCurrent, zeroForOne);

        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(job.amountIn),
                sqrtPriceLimitX96: sqrtPriceLimit
            }),
            ""
        );

        int128 ethDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 stockDelta = zeroForOne ? delta.amount1() : delta.amount0();

        // A tight sqrtPriceLimitX96 (unlike an effectively-unbounded one) can
        // genuinely be hit mid-swap — v4 doesn't revert when that happens, it
        // partially fills. Settling the full job.amountIn against a partial
        // fill would either revert on CurrencyNotSettled or overpay the pool,
        // so require the fill was exact: either the full amount converted
        // within maxSlippageBps, or the whole payout reverts and the caller
        // (ScratchCore.scratch()) can be retried once the price recovers.
        // safe: swap() always returns a negative delta for the input currency, magnitude
        // bounded by job.amountIn (a uint256 sourced from msg.value), so it fits uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 ethIn = uint256(uint128(-ethDelta));
        if (ethIn != job.amountIn) revert SlippageExceeded();

        // ethDelta is negative (we owe the pool); settle it with the ETH we received.
        poolManager.sync(ethCurrency);
        poolManager.settle{value: ethIn}();

        // stockDelta is positive (pool owes us); take it and send straight to recipient.
        // safe: swap() always returns a non-negative delta for the output currency.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 stockOut = uint256(uint128(stockDelta));
        poolManager.take(stockCurrency, job.recipient, stockOut);

        return abi.encode(stockOut);
    }

    /// A price-space bound of maxSlippageBps corresponds to roughly
    /// maxSlippageBps/2 in sqrt-price space (price = sqrtPrice²), so the
    /// denominator here is 20,000 (2 * BPS_DENOM) rather than 10,000. The
    /// linear approximation this implies (sqrt(1±x) ≈ 1±x/2) is accurate to
    /// better than 1 part in 10^7 at these magnitudes — negligible next to
    /// the bound's own ~0.1% width.
    function _slippageBound(uint160 sqrtPriceCurrent, bool zeroForOne) internal view returns (uint160) {
        uint256 bps = maxSlippageBps;
        uint256 bound;
        if (zeroForOne) {
            // Price can fall as currency0 is sold into the pool; floor it.
            bound = (uint256(sqrtPriceCurrent) * (20_000 - bps)) / 20_000;
            if (bound < TickMath.MIN_SQRT_PRICE + 1) bound = TickMath.MIN_SQRT_PRICE + 1;
        } else {
            // Price can rise as currency1 is sold into the pool; cap it.
            bound = (uint256(sqrtPriceCurrent) * (20_000 + bps)) / 20_000;
            if (bound > TickMath.MAX_SQRT_PRICE - 1) bound = TickMath.MAX_SQRT_PRICE - 1;
        }
        // safe: bound is clamped above to [MIN_SQRT_PRICE + 1, MAX_SQRT_PRICE - 1],
        // both of which already fit uint160 (TickMath.MAX_SQRT_PRICE is itself a uint160).
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(bound);
    }

    receive() external payable {}
}
