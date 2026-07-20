import { useEffect, useState } from "react";
import { KEEPER_API_URL } from "../lib/chain";
import type { Tier } from "../lib/types";
import { tierFromOnchain } from "../lib/onchain";

const POLL_INTERVAL_MS = 8_000;

export interface ScoreboardWinEntry {
  id: string;
  player: `0x${string}`;
  tier: Tier;
  stockToken: `0x${string}`;
  amountWei: bigint;
  timestamp: number;
  txHash: string;
}

export interface ScoreboardData {
  ethUsdPrice: number | undefined;
  dailyCap: bigint | undefined;
  cardsSoldToday: bigint | undefined;
  jackpotPotWei: bigint | undefined;
  instantPoolWei: bigint | undefined;
  totalPaidOutWei: bigint;
  wins: ScoreboardWinEntry[];
}

interface RawResponse {
  ethUsdPrice: number | undefined;
  dailyCap: string | undefined;
  cardsSoldToday: string | undefined;
  jackpotPotWei: string | undefined;
  instantPoolWei: string | undefined;
  totalPaidOutWei: string;
  wins: { id: string; player: `0x${string}`; tier: number; stockToken: `0x${string}`; amountWei: string; timestamp: number; txHash: string }[];
}

function parse(raw: RawResponse): ScoreboardData {
  return {
    ethUsdPrice: raw.ethUsdPrice,
    dailyCap: raw.dailyCap === undefined ? undefined : BigInt(raw.dailyCap),
    cardsSoldToday: raw.cardsSoldToday === undefined ? undefined : BigInt(raw.cardsSoldToday),
    jackpotPotWei: raw.jackpotPotWei === undefined ? undefined : BigInt(raw.jackpotPotWei),
    instantPoolWei: raw.instantPoolWei === undefined ? undefined : BigInt(raw.instantPoolWei),
    totalPaidOutWei: BigInt(raw.totalPaidOutWei),
    wins: raw.wins.map((w) => ({ ...w, tier: tierFromOnchain(w.tier), amountWei: BigInt(w.amountWei) })),
  };
}

// Module-level, not component state — same reasoning as the old scanning
// hooks had: survives react-router remounts within a session so revisiting
// the page doesn't flash back to nothing while the next poll comes in.
// Unlike those hooks this no longer needs localStorage — the keeper's own
// cache is already instant for every visitor, first-time or not, so
// there's nothing left for the client to persist across page loads.
let cached: ScoreboardData | undefined;

/// Fetches the keeper's dashboard-cache API instead of scanning the chain
/// itself — see keeper/src/dashboardCache.ts. undefined until the first
/// successful fetch, or if VITE_KEEPER_API_URL is unset.
export function useScoreboardApi(): ScoreboardData | undefined {
  const [data, setData] = useState<ScoreboardData | undefined>(cached);

  useEffect(() => {
    if (!KEEPER_API_URL) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${KEEPER_API_URL}/api/scoreboard`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parse(await res.json());
        cached = parsed;
        if (!cancelled) setData(parsed);
      } catch (err) {
        console.error("[useScoreboardApi] fetch failed:", err);
      }
    }

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return data;
}
