import { useEffect, useRef, useState } from "react";
import { publicClient, SCRATCH_CORE_ADDRESS } from "../lib/chain";
import { scratchCoreAbi } from "../lib/scratchCoreAbi";

const POLL_INTERVAL_MS = 4000;

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

/// Client-side read-only watcher: no wallet, no signing, just polling the
/// same events keeper/src/revealWatcher.ts uses to crank reveals. Given a
/// player address, watches for the next Bought event that address sends
/// (from the moment watching starts, not their whole history), then follows
/// that ticket until keeper/revealWatcher.ts scratches it and a Scratched
/// event appears. Purely a read — scratch() stays permissionless and the
/// keeper's job; this hook never sends a transaction.
export function useTicketWatcher(player: `0x${string}` | undefined, resetKey: number = 0): TicketWatchStatus {
  const [status, setStatus] = useState<TicketWatchStatus>({ phase: "idle" });
  const ticketIdRef = useRef<bigint | null>(null);

  useEffect(() => {
    ticketIdRef.current = null;

    if (!player || !SCRATCH_CORE_ADDRESS) {
      setStatus({ phase: "idle" });
      return;
    }
    // Captured as a local so TS narrows it to non-undefined inside the
    // closures below — the module-level export stays `| undefined` since
    // it's genuinely unset until ScratchCore is deployed.
    const contractAddress = SCRATCH_CORE_ADDRESS;

    setStatus({ phase: "watching-for-payment" });
    let cancelled = false;
    let baselineBlock: bigint | null = null;

    async function poll() {
      if (cancelled) return;

      try {
        if (baselineBlock === null) {
          baselineBlock = await publicClient.getBlockNumber();
        }

        if (ticketIdRef.current === null) {
          const logs = await publicClient.getLogs({
            address: contractAddress,
            event: boughtEvent,
            args: { player },
            fromBlock: baselineBlock,
            toBlock: "latest",
          });
          if (logs.length > 0 && !cancelled) {
            const ticketId = logs[0].args.ticketId as bigint;
            ticketIdRef.current = ticketId;
            setStatus({ phase: "pending-reveal", ticketId, cardType: logs[0].args.cardType as number });
          }
        }

        const ticketId = ticketIdRef.current;
        if (ticketId !== null) {
          const ticket = await publicClient.readContract({
            address: contractAddress,
            abi: scratchCoreAbi,
            functionName: "tickets",
            args: [ticketId],
          });
          const [, cardType, stockToken, scratched] = ticket;

          if (scratched && !cancelled) {
            const logs = await publicClient.getLogs({
              address: contractAddress,
              event: scratchedEvent,
              args: { ticketId },
              fromBlock: baselineBlock,
              toBlock: "latest",
            });
            const revealLog = logs[0];
            if (revealLog) {
              setStatus({
                phase: "revealed",
                ticketId,
                cardType,
                tier: revealLog.args.tier as number,
                stockToken: (revealLog.args.stockToken as `0x${string}`) ?? stockToken,
                payout: revealLog.args.payout as bigint,
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
  }, [player, resetKey]);

  return status;
}
