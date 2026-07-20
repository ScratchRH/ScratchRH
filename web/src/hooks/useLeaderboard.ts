import { useEffect, useState } from "react";
import { publicClient, SCRATCH_CORE_ADDRESS, SCRATCH_CORE_DEPLOY_BLOCK } from "../lib/chain";
import { scratchCoreAbi } from "../lib/scratchCoreAbi";

const POLL_INTERVAL_MS = 15_000; // ranking doesn't need to react within seconds
const SCAN_CHUNK_BLOCKS = 2_000n;
const MAX_ROWS = 50;

export interface LeaderboardRow {
  player: `0x${string}`;
  cardsScratched: number;
  totalWonWei: bigint;
}

const floorPaidEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "FloorPaid")!;
const wonEvent = scratchCoreAbi.find((e) => e.type === "event" && e.name === "Won")!;

interface PlayerAgg {
  player: `0x${string}`;
  cardsScratched: number;
  totalWonWei: bigint;
}

// Same reasoning as useWinsFeed.ts: module-level (survives react-router
// remounts within a session) AND persisted to localStorage (survives a
// fresh page load too) — a full-history per-player scan is the most
// expensive one on this site, so re-running it from
// SCRATCH_CORE_DEPLOY_BLOCK on every visit would be both slow to display
// and wasteful of RPC calls. A remount/reload resumes from
// lastScannedBlock instead.
const STORAGE_KEY = "scratch:leaderboard";

interface StoredLeaderboard {
  players: [string, { cardsScratched: number; totalWonWei: string }][];
  lastScannedBlock: string;
}

function readStored(): { players: Map<string, PlayerAgg>; lastScannedBlock: bigint } | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredLeaderboard;
    const players = new Map<string, PlayerAgg>();
    for (const [addr, agg] of parsed.players) {
      players.set(addr, { player: addr as `0x${string}`, cardsScratched: agg.cardsScratched, totalWonWei: BigInt(agg.totalWonWei) });
    }
    return { players, lastScannedBlock: BigInt(parsed.lastScannedBlock) };
  } catch {
    return undefined;
  }
}

function storePlayers(players: Map<string, PlayerAgg>, lastScannedBlock: bigint): void {
  try {
    const payload: StoredLeaderboard = {
      players: [...players.entries()].map(([addr, agg]) => [addr, { cardsScratched: agg.cardsScratched, totalWonWei: agg.totalWonWei.toString() }]),
      lastScannedBlock: lastScannedBlock.toString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.) - just skip persisting.
  }
}

const stored = readStored();
const playerTotals: Map<string, PlayerAgg> = stored?.players ?? new Map();
let lastScannedBlock: bigint | null = stored?.lastScannedBlock ?? null;
// Same overlapping-scan hazard as useWinsFeed.ts (setInterval doesn't wait
// for an async callback) — guards against double-counting a player's wins
// if a scan runs long.
let scanInFlight = false;
// A full-history scan (unlike the capped-40 recent feed) can take real time
// on a cold browser with nothing in localStorage yet — distinguishes "still
// scanning, don't know yet" from "confirmed zero players" so the page
// doesn't show a false "no cards scratched yet" while it's mid-scan.
let hasScannedOnce = stored !== undefined;

function sortedRows(): LeaderboardRow[] {
  return [...playerTotals.values()]
    .sort((a, b) => (a.totalWonWei === b.totalWonWei ? 0 : a.totalWonWei > b.totalWonWei ? -1 : 1))
    .slice(0, MAX_ROWS)
    .map(({ player, cardsScratched, totalWonWei }) => ({ player, cardsScratched, totalWonWei }));
}

/// Scans FloorPaid + Won since ScratchCore's deploy block and aggregates by
/// player — every resolved ticket emits exactly one of the two (mutually
/// exclusive by contract design), so their union covers every scratch.
/// Ranked by total won; cardsScratched is just a count of that same union
/// per player, not a separate read.
export function useLeaderboard(): LeaderboardRow[] | undefined {
  const [rows, setRows] = useState<LeaderboardRow[] | undefined>(() => (hasScannedOnce ? sortedRows() : undefined));

  useEffect(() => {
    if (!SCRATCH_CORE_ADDRESS) return;
    const contractAddress = SCRATCH_CORE_ADDRESS;
    let cancelled = false;

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
      if (chunkStart > latest) {
        markScannedOnce();
        return;
      }

      while (chunkStart <= latest && !cancelled) {
        const chunkEnd = chunkStart + SCAN_CHUNK_BLOCKS - 1n < latest ? chunkStart + SCAN_CHUNK_BLOCKS - 1n : latest;

        let floorLogs, wonLogs;
        try {
          [floorLogs, wonLogs] = await Promise.all([
            publicClient.getLogs({ address: contractAddress, event: floorPaidEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
            publicClient.getLogs({ address: contractAddress, event: wonEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
          ]);
        } catch (err) {
          console.error(`[useLeaderboard] getLogs ${chunkStart}-${chunkEnd} failed, resuming next poll:`, err);
          break;
        }

        const combined = [
          ...floorLogs.map((log) => ({ player: log.args.player as string, amountWei: log.args.amount as bigint })),
          ...wonLogs.map((log) => ({ player: log.args.player as string, amountWei: log.args.payout as bigint })),
        ];

        let changed = false;
        for (const { player: rawPlayer, amountWei } of combined) {
          const player = rawPlayer.toLowerCase() as `0x${string}`;
          const existing = playerTotals.get(player);
          if (existing) {
            existing.cardsScratched += 1;
            existing.totalWonWei += amountWei;
          } else {
            playerTotals.set(player, { player, cardsScratched: 1, totalWonWei: amountWei });
          }
          changed = true;
        }

        lastScannedBlock = chunkEnd;
        // Persisted every chunk, not just changed ones, so lastScannedBlock
        // keeps advancing in storage through empty chunks too.
        storePlayers(playerTotals, lastScannedBlock);
        if (changed && !cancelled) setRows(sortedRows());
        chunkStart = chunkEnd + 1n;
      }
      markScannedOnce();
    }

    function markScannedOnce() {
      if (hasScannedOnce || cancelled) return;
      hasScannedOnce = true;
      setRows(sortedRows());
    }

    scan();
    const interval = window.setInterval(scan, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return rows;
}
