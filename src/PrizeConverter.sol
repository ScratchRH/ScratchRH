// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPrizeConverter} from "./interfaces/IPrizeConverter.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {IUniswapV3Pool, IUniswapV3SwapCallback} from "./interfaces/IUniswapV3Pool.sol";
import {IAlgebraPool, IAlgebraSwapCallback} from "./interfaces/IAlgebraPool.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// Real IPrizeConverter implementation: swaps native ETH into a stock token
/// through whatever real route that token actually has on Robinhood Chain —
/// confirmed 2026-07-19 by decoding six live swap transactions (SPY, AAPL,
/// MSFT, NVDA, TSLA, PLTR), which showed three different shapes:
///   - SPY, PLTR:        WETH -> stock, single Algebra hop
///   - NVDA, MSFT:       WETH -> USDG (Uniswap V3) -> stock (Uniswap V4)
///   - AAPL:              WETH -> USDG (V4) -> stock (V4)
/// No single-protocol design covers all six, so this contract stores an
/// ordered list of hops per stock token (`routes`) and walks it generically
/// — Algebra and V3 hops execute as direct pool calls with a swap callback,
/// V4 hops execute inside a poolManager.unlock() session, consecutive V4
/// hops sharing one unlock.
///
/// Every confirmed real route starts by wrapping ETH into WETH before the
/// first hop (the previous native-ETH-only design in UniswapV4PrizeConverter
/// never matched live liquidity for this reason) — so `convert()` always
/// wraps msg.value into WETH first, then the route takes over from there.
///
/// One route per stock token, configured by `owner` after deploy. Owner sets
/// the full hop list in one call via `setRoute` — a route once set is
/// replaced wholesale, not patched hop-by-hop, so a single call can't leave
/// half old, half new hops live.
contract PrizeConverter is IPrizeConverter, IUnlockCallback, IUniswapV3SwapCallback, IAlgebraSwapCallback {
    using StateLibrary for IPoolManager;

    enum Protocol {
        Algebra,
        V3,
        V4
    }

    /// One AMM hop. `pool` is the Algebra/V3 pool address for those
    /// protocols; for V4 the pool is implicit (derived from tokenIn/tokenOut
    /// + fee/tickSpacing/hooks via PoolKey) so `pool` is unused there.
    /// `tokenOut` is always this hop's output token, letting the loop in
    /// `_executeRoute`/`_executeV4Group` walk the chain without needing to
    /// separately track tokenIn (it's always the previous hop's tokenOut,
    /// or WETH for the first hop).
    struct Hop {
        Protocol protocol;
        address pool;
        address tokenOut;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    IPoolManager public immutable poolManager;
    IWETH public immutable weth;
    address public immutable owner;

    /// Max allowed price movement across the WHOLE route (not per-hop), in
    /// bps out of 10,000 — a plain percentage of the pre-swap spot quote,
    /// not the halved sqrt-price-space bps the old single-pool design used
    /// (that bounded sqrtPriceLimitX96 directly; this bounds a final output
    /// amount instead, so no halving applies). Checked once, against a spot
    /// quote taken across every hop immediately before executing, rather
    /// than per-hop: the three protocols represent price differently
    /// (slot0 vs globalState vs getSlot0) so one route-level output-amount
    /// check generalizes cleanly where a per-hop sqrt-price check would need
    /// three separate implementations. Individual hops execute with
    /// unbounded sqrtPriceLimitX96 (see _UNBOUNDED_* below) — this route
    /// -level check is the only slippage protection. Default 15 = 0.15%,
    /// matching the prior single-pool design's default.
    uint16 public maxSlippageBps = 15;

    uint256 private constant BPS_DENOM = 10_000;

    /// Real pool LP fees (Algebra's lastFee, Uniswap V3's fee(), a V4 pool's
    /// static fee) are denominated in hundredths of a basis point out of
    /// this — fee=3000 means 0.3%, fee=20000 means 2%. Used to fee-adjust
    /// the quote in _quoteMinAmountOut; see that function's doc comment for
    /// why this matters.
    uint256 private constant FEE_DENOM = 1_000_000;

    mapping(address stockToken => Hop[]) public routes;

    struct SwapJob {
        address stockToken;
        address recipient;
        uint256 amountIn;
        uint256 minAmountOut;
    }

    /// Transient state for the pool currently mid-callback, so
    /// uniswapV3SwapCallback/algebraSwapCallback know which token to pay and
    /// how much — both callbacks only tell us the signed deltas, not which
    /// pool called (msg.sender is the pool itself, which is how we verify
    /// it's the one we expected), and give us no token address at all.
    address private _pendingCallbackPool;
    address private _pendingCallbackToken;

    error OwnerOnly();
    error RouteNotConfigured(address stockToken);
    error EmptyRoute();
    error NotPoolManager();
    error NoEthSent();
    error InvalidSlippageBps();
    error SlippageExceeded();
    error UnexpectedCallbackCaller();
    error UnexpectedCallbackDeltas();
    error TransferFailed();

    constructor(IPoolManager _poolManager, IWETH _weth, address _owner) {
        poolManager = _poolManager;
        weth = _weth;
        owner = _owner;
    }

    /// Replaces `stockToken`'s entire route in one call. Not callable by
    /// scratch()/convert() callers, only by `owner`. Each hop's `tokenOut`
    /// must chain correctly (first hop's tokenOut feeds the second hop's
    /// implicit tokenIn, etc.) and the last hop's tokenOut must equal
    /// `stockToken` — not enforced on-chain (would need per-protocol token0/
    /// token1 calls this function has no reason to make), so get this right
    /// at the call site; a wrong chain fails loudly the first time
    /// `convert()` is called against it, not silently.
    function setRoute(address stockToken, Hop[] calldata hops) external {
        if (msg.sender != owner) revert OwnerOnly();
        if (hops.length == 0) revert EmptyRoute();
        delete routes[stockToken];
        for (uint256 i = 0; i < hops.length; i++) {
            routes[stockToken].push(hops[i]);
        }
    }

    /// Bounded to [1, 100] bps (0.01%-1%), same rationale and range as the
    /// prior single-pool design.
    function setMaxSlippageBps(uint16 bps) external {
        if (msg.sender != owner) revert OwnerOnly();
        if (bps == 0 || bps > 100) revert InvalidSlippageBps();
        maxSlippageBps = bps;
    }

    function convert(address stockToken, address recipient) external payable returns (uint256 amountOut) {
        if (msg.value == 0) revert NoEthSent();
        Hop[] memory hops = routes[stockToken];
        if (hops.length == 0) revert RouteNotConfigured(stockToken);

        weth.deposit{value: msg.value}();

        uint256 minAmountOut = _quoteMinAmountOut(hops, msg.value);

        amountOut = _executeRoute(hops, msg.value, recipient);
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }

    // ---------------------------------------------------------------------
    // Quoting
    // ---------------------------------------------------------------------

    /// Walks the route read-only, chaining each hop's spot price (no swap
    /// side effects), then applies maxSlippageBps to the final quoted amount
    /// to get the floor _executeRoute's real output must clear.
    ///
    /// Each hop's real LP fee is deducted from the running amount before
    /// that hop's price is applied — a real pool takes its fee out of the
    /// input before running the curve, so a quote that only multiplies by
    /// spot price (ignoring fee entirely) systematically overstates the
    /// true output by roughly the fee percentage. Confirmed the hard way:
    /// the very first live convert() against the real WETH->USDG->stock
    /// routes reverted SlippageExceeded even with no adversarial price
    /// movement at all — the fee-blind quote alone (0.01% WETH/USDG + up to
    /// 2% on the stock leg) already exceeded maxSlippageBps's 0.15% default,
    /// and would have exceeded even its 1% hard ceiling for the 2%-fee
    /// pools (MSFT, PLTR), making those two permanently unfillable
    /// regardless of tuning. Fixed by fee-adjusting the quote so
    /// maxSlippageBps bounds genuine price movement, not the pool's own
    /// advertised fee.
    function _quoteMinAmountOut(Hop[] memory hops, uint256 amountIn) internal view returns (uint256) {
        address tokenIn = address(weth);
        uint256 amount = amountIn;
        for (uint256 i = 0; i < hops.length; i++) {
            Hop memory hop = hops[i];
            (uint160 sqrtPriceX96, bool zeroForOne, uint24 fee) = _hopSpotPrice(tokenIn, hop);
            uint256 amountInAfterFee = amount - (amount * fee) / FEE_DENOM;
            amount = _quoteHop(sqrtPriceX96, amountInAfterFee, zeroForOne);
            tokenIn = hop.tokenOut;
        }
        return (amount * (BPS_DENOM - maxSlippageBps)) / BPS_DENOM;
    }

    /// Reads the current sqrtPriceX96, whether `tokenIn` is the pool's
    /// currency0 (zeroForOne), and the real fee-in-effect for `hop`,
    /// branching per protocol since each one exposes this differently. For
    /// Algebra and V3, the fee is read live from the pool itself
    /// (globalState's lastFee / fee()) rather than trusted from the Hop
    /// struct — Algebra's fee is genuinely dynamic (can change pool-side
    /// between setRoute and convert()), and V3's, while immutable once the
    /// pool exists, costs nothing extra to read from the source of truth
    /// instead of relying on setRoute's caller having copied it correctly.
    /// V4 is the one case where the Hop struct's `fee` IS the source of
    /// truth: it's baked into the PoolKey/PoolId used to find the pool at
    /// all, so it's load-bearing before any fee-adjustment even comes into
    /// it. For V4 the pool is implicit (no stored address), so the key is
    /// derived the same way _v4PoolKey does it for execution — keeping
    /// quote and execute looking at the identical pool.
    function _hopSpotPrice(address tokenIn, Hop memory hop)
        internal
        view
        returns (uint160 sqrtPriceX96, bool zeroForOne, uint24 fee)
    {
        if (hop.protocol == Protocol.Algebra) {
            IAlgebraPool pool = IAlgebraPool(hop.pool);
            zeroForOne = tokenIn == pool.token0();
            uint16 lastFee;
            (sqrtPriceX96,, lastFee,,,) = pool.globalState();
            fee = lastFee;
        } else if (hop.protocol == Protocol.V3) {
            IUniswapV3Pool pool = IUniswapV3Pool(hop.pool);
            zeroForOne = tokenIn == pool.token0();
            (sqrtPriceX96,,,,,,) = pool.slot0();
            fee = pool.fee();
        } else {
            zeroForOne = tokenIn < hop.tokenOut;
            (sqrtPriceX96,,,) = poolManager.getSlot0(_v4PoolKey(tokenIn, hop).toId());
            fee = hop.fee;
        }
    }

    /// amountOut = amountIn * price (zeroForOne) or amountIn / price
    /// (!zeroForOne), where price = (sqrtPriceX96 / 2^96)^2. Applied as two
    /// chained FullMath.mulDiv calls rather than squaring sqrtPriceX96 into
    /// a single Q192 ratio first: sqrtPriceX96 can be large enough (up to
    /// ~1.46e48, TickMath.MAX_SQRT_PRICE) that a bare squaring overflows
    /// uint256 for extreme prices, and mulDiv's 512-bit intermediate only
    /// protects the multiplication it's directly given, not a value already
    /// truncated before it gets there.
    function _quoteHop(uint160 sqrtPriceX96, uint256 amountIn, bool zeroForOne) internal pure returns (uint256) {
        if (zeroForOne) {
            uint256 step = FullMath.mulDiv(amountIn, sqrtPriceX96, FixedPoint96.Q96);
            return FullMath.mulDiv(step, sqrtPriceX96, FixedPoint96.Q96);
        } else {
            uint256 step = FullMath.mulDiv(amountIn, FixedPoint96.Q96, sqrtPriceX96);
            return FullMath.mulDiv(step, FixedPoint96.Q96, sqrtPriceX96);
        }
    }

    // ---------------------------------------------------------------------
    // Execution
    // ---------------------------------------------------------------------

    /// Walks the route for real, executing each hop and feeding its output
    /// into the next. Algebra/V3 hops are direct pool.swap() calls that
    /// settle synchronously via a callback; consecutive V4 hops are batched
    /// into a single poolManager.unlock() so they share one lock/settle
    /// session instead of paying unlock overhead per hop. Every hop settles
    /// its output to address(this) regardless of protocol or position in the
    /// route (simpler and protocol-uniform vs. special-casing "send the last
    /// hop straight to recipient"); the accumulated final-token balance is
    /// forwarded to `recipient` once, at the end.
    function _executeRoute(Hop[] memory hops, uint256 amountIn, address recipient) internal returns (uint256) {
        address tokenIn = address(weth);
        uint256 amount = amountIn;
        uint256 i = 0;
        while (i < hops.length) {
            if (hops[i].protocol == Protocol.V4) {
                uint256 j = i + 1;
                while (j < hops.length && hops[j].protocol == Protocol.V4) {
                    j++;
                }
                bytes memory result =
                    poolManager.unlock(abi.encode(V4Group({tokenIn: tokenIn, amountIn: amount, hops: hops, start: i, end: j})));
                amount = abi.decode(result, (uint256));
                tokenIn = hops[j - 1].tokenOut;
                i = j;
            } else {
                amount = _executeDirectHop(tokenIn, hops[i], amount);
                tokenIn = hops[i].tokenOut;
                i++;
            }
        }

        if (!IERC20(tokenIn).transfer(recipient, amount)) revert TransferFailed();
        return amount;
    }

    /// Executes one Algebra or V3 hop as a direct pool call. Both protocols
    /// share an identical swap signature shape and callback settlement
    /// pattern (only the interface type differs), so this one function
    /// handles both rather than duplicating the call/settle logic twice.
    function _executeDirectHop(address tokenIn, Hop memory hop, uint256 amountIn) internal returns (uint256) {
        bool zeroForOne;
        int256 amount0;
        int256 amount1;

        _pendingCallbackPool = hop.pool;
        _pendingCallbackToken = tokenIn;

        // Both Algebra and Uniswap V3 use a positive amountSpecified/
        // amountRequired for exact-input swaps (confirmed against real
        // interface source) — the opposite convention from V4 below.
        if (hop.protocol == Protocol.Algebra) {
            IAlgebraPool pool = IAlgebraPool(hop.pool);
            zeroForOne = tokenIn == pool.token0();
            // safe: amountIn is a token balance sourced from msg.value or a prior hop's
            // output, always far below int256's range.
            int256 amountSpecified;
            // forge-lint: disable-next-line(unsafe-typecast)
            amountSpecified = int256(amountIn);
            (amount0, amount1) = pool.swap(address(this), zeroForOne, amountSpecified, _unboundedSqrtPriceLimit(zeroForOne), "");
        } else {
            IUniswapV3Pool pool = IUniswapV3Pool(hop.pool);
            zeroForOne = tokenIn == pool.token0();
            // safe: amountIn is a token balance sourced from msg.value or a prior hop's
            // output, always far below int256's range.
            int256 amountSpecified;
            // forge-lint: disable-next-line(unsafe-typecast)
            amountSpecified = int256(amountIn);
            (amount0, amount1) = pool.swap(address(this), zeroForOne, amountSpecified, _unboundedSqrtPriceLimit(zeroForOne), "");
        }

        _pendingCallbackPool = address(0);
        _pendingCallbackToken = address(0);

        // Exact-input convention: the delta for the token we paid in is
        // positive (settled already, in the callback below); the delta for
        // the token the pool paid us is negative, magnitude = amountOut.
        int256 outDelta = zeroForOne ? amount1 : amount0;
        // safe: outDelta is the output-side delta of an exact-input swap, always <= 0.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(-outDelta);
    }

    /// Settlement for both algebraSwapCallback and uniswapV3SwapCallback —
    /// identical signature, identical settlement shape (pay whichever delta
    /// is positive), so one function backs both external entry points.
    function _settleDirectCallback(int256 amount0Delta, int256 amount1Delta) internal {
        if (msg.sender != _pendingCallbackPool) revert UnexpectedCallbackCaller();

        bool zeroOwed = amount0Delta > 0;
        bool oneOwed = amount1Delta > 0;
        if (zeroOwed == oneOwed) revert UnexpectedCallbackDeltas(); // exactly one side must be owed

        uint256 owed = uint256(zeroOwed ? amount0Delta : amount1Delta);
        if (!IERC20(_pendingCallbackToken).transfer(msg.sender, owed)) revert TransferFailed();
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        _settleDirectCallback(amount0Delta, amount1Delta);
    }

    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        _settleDirectCallback(amount0Delta, amount1Delta);
    }

    // ---------------------------------------------------------------------
    // V4 execution (batched unlock)
    // ---------------------------------------------------------------------

    /// Encoded into poolManager.unlock() for a run of consecutive V4 hops:
    /// hops[start:end) of the full route array, plus the running token/
    /// amount the group starts from. Carrying the full array + bounds
    /// (rather than a copied sub-array) avoids a manual memory-array slice
    /// helper — abi.encode/decode handles it directly.
    struct V4Group {
        address tokenIn;
        uint256 amountIn;
        Hop[] hops;
        uint256 start;
        uint256 end;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        V4Group memory job = abi.decode(data, (V4Group));

        address tokenIn = job.tokenIn;
        uint256 amount = job.amountIn;

        for (uint256 k = job.start; k < job.end; k++) {
            Hop memory hop = job.hops[k];
            bool zeroForOne = tokenIn < hop.tokenOut;
            PoolKey memory key = _v4PoolKey(tokenIn, hop);

            // V4 flips the sign convention: negative amountSpecified means
            // exact input (confirmed against real interface source) — the
            // opposite of Algebra/V3's positive-for-exact-input above.
            // safe: amount is a token balance sourced from msg.value or a prior hop's
            // output, always far below int256's range.
            int256 amountSpecified;
            // forge-lint: disable-next-line(unsafe-typecast)
            amountSpecified = -int256(amount);
            BalanceDelta delta = poolManager.swap(
                key,
                IPoolManager.SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: amountSpecified,
                    sqrtPriceLimitX96: _unboundedSqrtPriceLimit(zeroForOne)
                }),
                ""
            );

            int128 inDelta = zeroForOne ? delta.amount0() : delta.amount1();
            int128 outDelta = zeroForOne ? delta.amount1() : delta.amount0();

            Currency tokenInCurrency = Currency.wrap(tokenIn);
            Currency tokenOutCurrency = Currency.wrap(hop.tokenOut);

            // safe: swap() always returns a non-positive delta for the input currency
            // in exact-input mode, magnitude bounded by `amount` (a uint256).
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 owed = uint256(uint128(-inDelta));
            poolManager.sync(tokenInCurrency);
            if (!IERC20(tokenIn).transfer(address(poolManager), owed)) revert TransferFailed();
            poolManager.settle();

            // safe: swap() always returns a non-negative delta for the output currency.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 gotOut = uint256(uint128(outDelta));
            poolManager.take(tokenOutCurrency, address(this), gotOut);

            amount = gotOut;
            tokenIn = hop.tokenOut;
        }

        return abi.encode(amount);
    }

    /// Builds the PoolKey for a V4 hop from `tokenIn` and the hop's declared
    /// tokenOut — V4 has no separate pool address to read (unlike Algebra/
    /// V3), the pool is entirely identified by its sorted currency pair plus
    /// fee/tickSpacing/hooks. Shared by quoting and execution so both are
    /// guaranteed to look at the same pool.
    function _v4PoolKey(address tokenIn, Hop memory hop) internal pure returns (PoolKey memory) {
        bool zeroForOne = tokenIn < hop.tokenOut;
        return zeroForOne
            ? PoolKey({
                currency0: Currency.wrap(tokenIn),
                currency1: Currency.wrap(hop.tokenOut),
                fee: hop.fee,
                tickSpacing: hop.tickSpacing,
                hooks: IHooks(hop.hooks)
            })
            : PoolKey({
                currency0: Currency.wrap(hop.tokenOut),
                currency1: Currency.wrap(tokenIn),
                fee: hop.fee,
                tickSpacing: hop.tickSpacing,
                hooks: IHooks(hop.hooks)
            });
    }

    // ---------------------------------------------------------------------
    // Shared helpers
    // ---------------------------------------------------------------------

    /// Every hop executes with an effectively-unbounded price limit; the
    /// route-level maxSlippageBps check against the pre-computed quote (see
    /// convert()) is the only slippage protection, not a per-hop bound —
    /// see the maxSlippageBps doc comment for why. +1/-1 off the true min/
    /// max because both AMMs reject a limit exactly at MIN/MAX_SQRT_PRICE.
    function _unboundedSqrtPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    receive() external payable {}
}
