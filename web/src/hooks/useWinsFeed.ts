import { useEffect, useRef, useState } from "react";
import { publicClient, SCRATCH_CORE_ADDRESS, SCRATCH_CORE_DEPLOY_BLOCK } from "../lib/chain";
import { scratchCoreAbi } from "../lib/scratchCoreAbi";
import { symbolForStockToken, tierFromOnchain } from "../lib/onchain";
import type { Tier } from "../lib/types";

const POLL_INTERVAL_MS = 8_000;
const MAX_FEED_LEN = 40;
// Generous relative to the keeper's 10-block Alchemy-free-tier chunk size —
// the web app reads through the public RPC, not Alchemy, and hasn't shown
// the same range cap.
const SCAN_CHUNK_BLOCKS = 2_000n;

export interface RawWinEntry {
  id: string;
  player: `0x${string}`;
  tier: Tier;
  stockSymbol: string;
  amountWei: bigint;
  timestamp: number;
}

export interface WinsFeedState {
  totalPaidOutWei: bigint;
  entries: RawWinEntry[]; // newest first, capped at MAX_FEED_LEN
}

const floorPaidEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "FloorPaid")!;
const wonEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "Won")!;
// Won doesn't carry stockToken itself — only Scratched does, emitted in the
// same tx right before it — so a ticketId -> stockToken map from Scratched
// logs in the same range fills that in for Won-based entries.
const scratchedEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "Scratched")!;

/// Scans FloorPaid + Won since ScratchCore's deploy block to reconstruct a
/// running paid-out total and a live wins feed — nothing on-chain tracks a
/// cumulative total directly, so this rebuilds it from event history.
/// Amounts are ETH wei committed to PrizeConverter.convert(), not the stock
/// tokens actually delivered — an honest "value paid out" figure, but it
/// can differ slightly from what players received if a route's DEX fee ate
/// into the swap.
export function useWinsFeed(): WinsFeedState {
  const [state, setState] = useState<WinsFeedState>({ totalPaidOutWei: 0n, entries: [] });
  const lastScannedBlockRef = useRef<bigint | null>(null);
  const blockTimestampCache = useRef<Map<bigint, number>>(new Map());

  useEffect(() => {
    if (!SCRATCH_CORE_ADDRESS) return;
    const contractAddress = SCRATCH_CORE_ADDRESS;
    let cancelled = false;

    async function timestampFor(blockNumber: bigint): Promise<number> {
      const cached = blockTimestampCache.current.get(blockNumber);
      if (cached !== undefined) return cached;
      const block = await publicClient.getBlock({ blockNumber });
      const ms = Number(block.timestamp) * 1000;
      blockTimestampCache.current.set(blockNumber, ms);
      return ms;
    }

    async function scan() {
      if (cancelled) return;
      const latest = await publicClient.getBlockNumber();
      let chunkStart = lastScannedBlockRef.current !== null ? lastScannedBlockRef.current + 1n : SCRATCH_CORE_DEPLOY_BLOCK;
      if (chunkStart > latest) return;

      while (chunkStart <= latest && !cancelled) {
        const chunkEnd = chunkStart + SCAN_CHUNK_BLOCKS - 1n < latest ? chunkStart + SCAN_CHUNK_BLOCKS - 1n : latest;

        let floorLogs, wonLogs, scratchedLogs;
        try {
          [floorLogs, wonLogs, scratchedLogs] = await Promise.all([
            publicClient.getLogs({ address: contractAddress, event: floorPaidEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
            publicClient.getLogs({ address: contractAddress, event: wonEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
            publicClient.getLogs({ address: contractAddress, event: scratchedEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
          ]);
        } catch (err) {
          console.error(`[useWinsFeed] getLogs ${chunkStart}-${chunkEnd} failed, resuming next poll:`, err);
          break;
        }

        const stockTokenByTicketId = new Map<bigint, string>();
        for (const log of scratchedLogs) {
          stockTokenByTicketId.set(log.args.ticketId as bigint, log.args.stockToken as string);
        }

        const combined = [
          ...floorLogs.map((log) => ({ log, tier: "None" as Tier, amountWei: log.args.amount as bigint, stockToken: log.args.stockToken as string })),
          ...wonLogs.map((log) => ({
            log,
            tier: tierFromOnchain(log.args.tier as number),
            amountWei: log.args.payout as bigint,
            stockToken: stockTokenByTicketId.get(log.args.ticketId as bigint) ?? "",
          })),
        ].sort((a, b) => {
          if (a.log.blockNumber !== b.log.blockNumber) return a.log.blockNumber! < b.log.blockNumber! ? -1 : 1;
          return a.log.logIndex! < b.log.logIndex! ? -1 : 1;
        });

        if (combined.length > 0) {
          const newEntries: RawWinEntry[] = [];
          let addedWei = 0n;
          for (const { log, tier, amountWei, stockToken } of combined) {
            addedWei += amountWei;
            newEntries.push({
              id: `${log.transactionHash}-${log.logIndex}`,
              player: log.args.player as `0x${string}`,
              tier,
              stockSymbol: symbolForStockToken(stockToken),
              amountWei,
              timestamp: await timestampFor(log.blockNumber!),
            });
          }

          if (!cancelled) {
            setState((prev) => ({
              totalPaidOutWei: prev.totalPaidOutWei + addedWei,
              entries: [...newEntries.reverse(), ...prev.entries].slice(0, MAX_FEED_LEN),
            }));
          }
        }

        lastScannedBlockRef.current = chunkEnd;
        chunkStart = chunkEnd + 1n;
      }
    }

    scan();
    const interval = window.setInterval(scan, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return state;
}
