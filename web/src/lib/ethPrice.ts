import { useEffect, useState } from "react";
import { publicClient } from "./chain";

// WETH/USDG Uniswap V3 pool on Robinhood Chain mainnet — the same pool used
// to price the $1/$5/$10 card repricing (2026-07-20). USDG is treated as
// ~$1; there's no USDG/USD oracle here, same assumption every stablecoin
// price read in this codebase makes.
const WETH_USDG_POOL = "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca" as const;
// token0 = WETH (18 decimals), token1 = USDG (6 decimals) — confirmed via
// token0()/token1()/decimals() against the live pool.
const DECIMALS_ADJUST = 12n; // 18 - 6

const slot0Abi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

const REFRESH_INTERVAL_MS = 60_000;
// Extra fixed-point digits kept through the BigInt math before converting to
// a JS Number, so the price doesn't get truncated down to a whole dollar.
const PRECISION_DIGITS = 6n;

async function fetchEthUsdPrice(): Promise<number> {
  const [sqrtPriceX96] = await publicClient.readContract({
    address: WETH_USDG_POOL,
    abi: slot0Abi,
    functionName: "slot0",
  });
  const scale = 10n ** (DECIMALS_ADJUST + PRECISION_DIGITS);
  const scaledPrice = (sqrtPriceX96 * sqrtPriceX96 * scale) / (2n ** 96n) ** 2n;
  return Number(scaledPrice) / 10 ** Number(PRECISION_DIGITS);
}

// Module-level, not component state — react-router unmounts Home.tsx/
// Flywheel.tsx on navigation, and without this every single visit to those
// pages would flash back to "undefined" and block on a fresh RPC round
// trip before showing anything, even seconds after the last visit already
// had a perfectly good price.
let cachedPrice: number | undefined;

/// Live ETH/USD spot price, refreshed every 60s. undefined until the first
/// successful read this session; returns the last known price immediately
/// on remount instead of resetting to undefined.
export function useEthUsdPrice(): number | undefined {
  const [price, setPrice] = useState<number | undefined>(cachedPrice);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await fetchEthUsdPrice();
        cachedPrice = next;
        if (!cancelled) setPrice(next);
      } catch (err) {
        console.error("[ethPrice] failed to fetch ETH/USD price:", err);
      }
    }

    poll();
    const interval = window.setInterval(poll, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return price;
}
