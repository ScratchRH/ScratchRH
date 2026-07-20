import { useEffect, useState } from "react";
import { KEEPER_API_URL } from "../lib/chain";

const POLL_INTERVAL_MS = 15_000;

export interface LeaderboardRow {
  player: `0x${string}`;
  cardsScratched: number;
  totalWonWei: bigint;
}

interface RawResponse {
  players: { player: `0x${string}`; cardsScratched: number; totalWonWei: string }[];
}

// Module-level, not component state — survives react-router remounts within
// a session. No localStorage needed here either: the keeper's own cache is
// already instant for every visitor, so there's nothing left for the client
// to persist across page loads.
let cached: LeaderboardRow[] | undefined;

/// Fetches the keeper's dashboard-cache API (ranked by total won) instead of
/// scanning the chain itself — see keeper/src/dashboardCache.ts. undefined
/// until the first successful fetch, or if VITE_KEEPER_API_URL is unset.
export function useLeaderboard(): LeaderboardRow[] | undefined {
  const [rows, setRows] = useState<LeaderboardRow[] | undefined>(cached);

  useEffect(() => {
    if (!KEEPER_API_URL) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${KEEPER_API_URL}/api/leaderboard`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as RawResponse;
        const parsed = raw.players.map((p) => ({ ...p, totalWonWei: BigInt(p.totalWonWei) }));
        cached = parsed;
        if (!cancelled) setRows(parsed);
      } catch (err) {
        console.error("[useLeaderboard] fetch failed:", err);
      }
    }

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return rows;
}
