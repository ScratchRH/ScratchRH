import { useEffect, useState } from "react";
import { publicClient, SCRATCH_CORE_ADDRESS } from "../lib/chain";
import { scratchCoreAbi } from "../lib/scratchCoreAbi";

// Slower than ticket-status polling — these numbers don't need to react
// within seconds the way a payment does.
const POLL_INTERVAL_MS = 15_000;

export interface GameStats {
  dailyCap: bigint;
  cardsSoldToday: bigint;
  jackpotPotWei: bigint;
}

// Module-level, not component state — Home.tsx unmounts on navigation, and
// without this every visit would flash back to "…" and wait on a fresh RPC
// round trip before showing numbers that were already known a moment ago.
let cachedStats: GameStats | undefined;

/// Polls ScratchCore's daily-cap and jackpot state directly. undefined until
/// the first successful read this session, or if SCRATCH_CORE_ADDRESS is
/// unset; returns the last known stats immediately on remount.
export function useGameStats(): GameStats | undefined {
  const [stats, setStats] = useState<GameStats | undefined>(cachedStats);

  useEffect(() => {
    if (!SCRATCH_CORE_ADDRESS) return;
    const contractAddress = SCRATCH_CORE_ADDRESS;
    let cancelled = false;

    async function poll() {
      try {
        const [dailyCap, cardsSoldToday, jackpotPotWei] = await Promise.all([
          publicClient.readContract({ address: contractAddress, abi: scratchCoreAbi, functionName: "dailyCap" }),
          publicClient.readContract({ address: contractAddress, abi: scratchCoreAbi, functionName: "cardsSoldToday" }),
          publicClient.readContract({ address: contractAddress, abi: scratchCoreAbi, functionName: "jackpotPot" }),
        ]);
        cachedStats = { dailyCap, cardsSoldToday, jackpotPotWei };
        if (!cancelled) setStats(cachedStats);
      } catch (err) {
        console.error("[useGameStats] poll failed:", err);
      }
    }

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return stats;
}
