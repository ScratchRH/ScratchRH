import { useEffect, useRef, useState } from "react";
import { publicClient, SCRATCH_CORE_ADDRESS } from "../lib/chain";
import { scratchCoreAbi } from "../lib/scratchCoreAbi";

const POLL_INTERVAL_MS = 2000;

export type TicketWatchStatus =
  | { phase: "idle" }
  | { phase: "watching-for-payment" }
  | { phase: "pending-reveal"; ticketId: bigint; cardType: number }
  | {
      phase: "revealed";
      ticketId: bigint;
      cardType: number;
      tier: number;
      stockToken: `0x${string}`;
      payout: bigint;
    };

const boughtEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "Bought")!;
const scratchedEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "Scratched")!;

/// Client-side read-only watcher. Given a player address and expected count,
/// watches for up to `count` Bought events from that address (from the moment
/// watching starts), then tracks each ticket until the keeper scratches it.
/// count=1 watches for a single buy(); count>1 watches for a buyBatch().
/// Returns one status slot per expected ticket, in buy order.
export function useTicketWatcher(
  player: `0x${string}` | undefined,
  resetKey: number = 0,
  count: number = 1,
): TicketWatchStatus[] {
  const [statuses, setStatuses] = useState<TicketWatchStatus[]>(() =>
    Array.from({ length: Math.max(1, count) }, () => ({ phase: "idle" as const })),
  );
  const ticketIdsRef = useRef<bigint[]>([]);

  useEffect(() => {
    ticketIdsRef.current = [];
    const targetCount = Math.max(1, count);

    if (!player || !SCRATCH_CORE_ADDRESS) {
      setStatuses(Array.from({ length: targetCount }, () => ({ phase: "idle" as const })));
      return;
    }
    const contractAddress = SCRATCH_CORE_ADDRESS;

    setStatuses(Array.from({ length: targetCount }, () => ({ phase: "watching-for-payment" as const })));
    let cancelled = false;
    let baselineBlock: bigint | null = null;

    async function poll() {
      if (cancelled) return;
      try {
        if (baselineBlock === null) {
          baselineBlock = await publicClient.getBlockNumber();
        }

        if (ticketIdsRef.current.length < targetCount) {
          const logs = await publicClient.getLogs({
            address: contractAddress,
            event: boughtEvent,
            args: { player },
            fromBlock: baselineBlock,
            toBlock: "latest",
          });
          const foundIds = logs.slice(0, targetCount).map((l) => l.args.ticketId as bigint);
          if (foundIds.length > ticketIdsRef.current.length) {
            ticketIdsRef.current = foundIds;
            if (!cancelled) {
              setStatuses((prev) => {
                const next = [...prev];
                for (let i = 0; i < foundIds.length; i++) {
                  next[i] = {
                    phase: "pending-reveal",
                    ticketId: foundIds[i],
                    cardType: logs[i].args.cardType as number,
                  };
                }
                return next;
              });
            }
          }
        }

        for (let i = 0; i < ticketIdsRef.current.length && !cancelled; i++) {
          const ticketId = ticketIdsRef.current[i];
          const ticket = await publicClient.readContract({
            address: contractAddress,
            abi: scratchCoreAbi,
            functionName: "tickets",
            args: [ticketId],
          });
          const [, cardType, stockToken, scratched] = ticket;
          if (scratched) {
            const revealLogs = await publicClient.getLogs({
              address: contractAddress,
              event: scratchedEvent,
              args: { ticketId },
              fromBlock: baselineBlock!,
              toBlock: "latest",
            });
            const revealLog = revealLogs[0];
            if (revealLog && !cancelled) {
              setStatuses((prev) => {
                if (prev[i]?.phase === "revealed") return prev;
                const next = [...prev];
                next[i] = {
                  phase: "revealed",
                  ticketId,
                  cardType,
                  tier: revealLog.args.tier as number,
                  stockToken: (revealLog.args.stockToken as `0x${string}`) ?? stockToken,
                  payout: revealLog.args.payout as bigint,
                };
                return next;
              });
            }
          }
        }
      } catch (err) {
        console.error("[useTicketWatcher] poll failed:", err);
      }
    }

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [player, resetKey, count]);

  return statuses;
}
