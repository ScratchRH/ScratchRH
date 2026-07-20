import { useEffect, useState } from "react";
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
  txHash: string;
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

// Module-level, not component/ref state — Home.tsx unmounts on navigation
// (react-router), and a useRef/useState pair resets on every remount just
// like a class instance would. Without this, revisiting the Scoreboard page
// re-scanned the entire history from SCRATCH_CORE_DEPLOY_BLOCK every single
// time and showed an empty feed while it did, even moments after the last
// visit had already scanned all of it. Module scope survives unmounts for
// the life of the page load, so a remount resumes from lastScannedBlock
// instead of starting over.
let cachedState: WinsFeedState = { totalPaidOutWei: 0n, entries: [] };
let lastScannedBlock: bigint | null = null;
const blockTimestampCache = new Map<bigint, number>();
const seenEntryIds = new Set<string>();
// Guards against two scan() calls running at once — e.g. a scan that takes
// longer than POLL_INTERVAL_MS to finish (setInterval doesn't wait for its
// async callback), or two mounts sharing this module-level state. Without
// it, two overlapping scans can both read the same lastScannedBlock before
// either advances it, both fetch the same range, and both append the same
// events — the visible symptom was duplicate rows in the live feed.
let scanInFlight = false;

/// Scans FloorPaid + Won since ScratchCore's deploy block to reconstruct a
/// running paid-out total and a live wins feed — nothing on-chain tracks a
/// cumulative total directly, so this rebuilds it from event history.
/// Amounts are ETH wei committed to PrizeConverter.convert(), not the stock
/// tokens actually delivered — an honest "value paid out" figure, but it
/// can differ slightly from what players received if a route's DEX fee ate
/// into the swap.
export function useWinsFeed(): WinsFeedState {
  const [state, setState] = useState<WinsFeedState>(cachedState);

  useEffect(() => {
    if (!SCRATCH_CORE_ADDRESS) return;
    const contractAddress = SCRATCH_CORE_ADDRESS;
    let cancelled = false;

    async function timestampFor(blockNumber: bigint): Promise<number> {
      const cached = blockTimestampCache.get(blockNumber);
      if (cached !== undefined) return cached;
      const block = await publicClient.getBlock({ blockNumber });
      const ms = Number(block.timestamp) * 1000;
      blockTimestampCache.set(blockNumber, ms);
      return ms;
    }

    async function scan() {
      if (cancelled || scanInFlight) return;
      scanInFlight = true;
      try {
        await scanOnce();
      } finally {
        scanInFlight = false;
      }
    }

    async function scanOnce() {
      const latest = await publicClient.getBlockNumber();
      let chunkStart = lastScannedBlock !== null ? lastScannedBlock + 1n : SCRATCH_CORE_DEPLOY_BLOCK;
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
            const id = `${log.transactionHash}-${log.logIndex}`;
            // Defense in depth against re-processing the same event twice
            // (e.g. a chunk boundary edge case) — scanInFlight above is the
            // actual fix for the concurrent-scan case, this just makes sure
            // a duplicate id can never reach the rendered feed either way.
            if (seenEntryIds.has(id)) continue;
            seenEntryIds.add(id);

            addedWei += amountWei;
            newEntries.push({
              id,
              player: log.args.player as `0x${string}`,
              tier,
              stockSymbol: symbolForStockToken(stockToken),
              amountWei,
              timestamp: await timestampFor(log.blockNumber!),
              txHash: log.transactionHash!,
            });
          }

          cachedState = {
            totalPaidOutWei: cachedState.totalPaidOutWei + addedWei,
            entries: [...newEntries.reverse(), ...cachedState.entries].slice(0, MAX_FEED_LEN),
          };
          if (!cancelled) setState(cachedState);
        }

        lastScannedBlock = chunkEnd;
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
