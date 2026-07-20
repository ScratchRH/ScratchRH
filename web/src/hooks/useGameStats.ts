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

/// Polls ScratchCore's daily-cap and jackpot state directly. undefined until
/// the first successful read, or if SCRATCH_CORE_ADDRESS is unset.
export function useGameStats(): GameStats | undefined {
  const [stats, setStats] = useState<GameStats | undefined>(undefined);

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
        if (!cancelled) setStats({ dailyCap, cardsSoldToday, jackpotPotWei });
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
