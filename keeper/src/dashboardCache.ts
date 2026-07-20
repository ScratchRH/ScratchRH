import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { publicClient } from "./chain.js";
import { config } from "./config.js";
import { scratchCoreAbi, floorPaidEvent, wonEvent, slot0Abi } from "./abi.js";

// Same value as web/src/lib/chain.ts's SCRATCH_CORE_DEPLOY_BLOCK — update
// both alongside SCRATCH_CORE_ADDRESS whenever ScratchCore gets redeployed.
const SCRATCH_CORE_DEPLOY_BLOCK = 14_794_301n;

const WETH_USDG_POOL = "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca" as const;
const DECIMALS_ADJUST = 12n; // WETH 18 decimals - USDG 6 decimals
const PRECISION_DIGITS = 6n;

const MAX_WINS = 40;
const MAX_LEADERBOARD_ROWS = 50;

export interface DashboardWinEntry {
  id: string;
  player: `0x${string}`;
  tier: number;
  stockToken: `0x${string}`;
  amountWei: string;
  timestamp: number;
  txHash: string;
}

export interface DashboardPlayerAgg {
  player: `0x${string}`;
  cardsScratched: number;
  totalWonWei: string;
}

interface DashboardState {
  lastScannedBlock: string | null;
  ethUsdPrice: number | undefined;
  ethUsdPriceUpdatedAt: number | undefined;
  dailyCap: string | undefined;
  cardsSoldToday: string | undefined;
  jackpotPotWei: string | undefined;
  gameStatsUpdatedAt: number | undefined;
  totalPaidOutWei: string;
  wins: DashboardWinEntry[]; // newest first, capped at MAX_WINS
  players: Record<string, { cardsScratched: number; totalWonWei: string }>;
}

function emptyState(): DashboardState {
  return {
    lastScannedBlock: null,
    ethUsdPrice: undefined,
    ethUsdPriceUpdatedAt: undefined,
    dailyCap: undefined,
    cardsSoldToday: undefined,
    jackpotPotWei: undefined,
    gameStatsUpdatedAt: undefined,
    totalPaidOutWei: "0",
    wins: [],
    players: {},
  };
}

function loadState(): DashboardState {
  if (!existsSync(config.dashboardCacheFile)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(config.dashboardCacheFile, "utf8")) };
  } catch (err) {
    console.error("[dashboard-cache] failed to load cache file, starting fresh:", err);
    return emptyState();
  }
}

function saveState(): void {
  try {
    writeFileSync(config.dashboardCacheFile, JSON.stringify(state));
  } catch (err) {
    console.error("[dashboard-cache] failed to persist cache file:", err);
  }
}

const state = loadState();

async function fetchEthUsdPrice(): Promise<number> {
  const [sqrtPriceX96] = await publicClient.readContract({ address: WETH_USDG_POOL, abi: slot0Abi, functionName: "slot0" });
  const scale = 10n ** (DECIMALS_ADJUST + PRECISION_DIGITS);
  const scaledPrice = (sqrtPriceX96 * sqrtPriceX96 * scale) / (2n ** 96n) ** 2n;
  return Number(scaledPrice) / 10 ** Number(PRECISION_DIGITS);
}

async function refreshEthPrice(): Promise<void> {
  try {
    state.ethUsdPrice = await fetchEthUsdPrice();
    state.ethUsdPriceUpdatedAt = Date.now();
  } catch (err) {
    console.error("[dashboard-cache] eth price refresh failed:", err);
  }
}

async function refreshGameStats(): Promise<void> {
  try {
    const [dailyCap, cardsSoldToday, jackpotPotWei] = await Promise.all([
      publicClient.readContract({ address: config.scratchCoreAddress, abi: scratchCoreAbi, functionName: "dailyCap" }),
      publicClient.readContract({ address: config.scratchCoreAddress, abi: scratchCoreAbi, functionName: "cardsSoldToday" }),
      publicClient.readContract({ address: config.scratchCoreAddress, abi: scratchCoreAbi, functionName: "jackpotPot" }),
    ]);
    state.dailyCap = dailyCap.toString();
    state.cardsSoldToday = cardsSoldToday.toString();
    state.jackpotPotWei = jackpotPotWei.toString();
    state.gameStatsUpdatedAt = Date.now();
  } catch (err) {
    console.error("[dashboard-cache] game stats refresh failed:", err);
  }
}

// Scans FloorPaid + Won since ScratchCore's deploy block. Their union covers
// every resolved ticket (mutually exclusive by contract design), so this
// both rebuilds the live-wins feed and the per-player leaderboard totals in
// one pass — nothing on-chain tracks either as a running counter directly.
const blockTimestampCache = new Map<bigint, number>();

async function timestampFor(blockNumber: bigint): Promise<number> {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached !== undefined) return cached;
  const block = await publicClient.getBlock({ blockNumber });
  const ms = Number(block.timestamp) * 1000;
  blockTimestampCache.set(blockNumber, ms);
  return ms;
}

async function scanEvents(): Promise<void> {
  const latest = await publicClient.getBlockNumber();
  let chunkStart = state.lastScannedBlock !== null ? BigInt(state.lastScannedBlock) + 1n : SCRATCH_CORE_DEPLOY_BLOCK;
  if (chunkStart > latest) return;

  while (chunkStart <= latest) {
    const chunkEnd = chunkStart + config.dashboardScanChunkBlocks - 1n < latest ? chunkStart + config.dashboardScanChunkBlocks - 1n : latest;

    let floorLogs, wonLogs;
    try {
      [floorLogs, wonLogs] = await Promise.all([
        publicClient.getLogs({ address: config.scratchCoreAddress, event: floorPaidEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
        publicClient.getLogs({ address: config.scratchCoreAddress, event: wonEvent, fromBlock: chunkStart, toBlock: chunkEnd }),
      ]);
    } catch (err) {
      console.error(`[dashboard-cache] getLogs ${chunkStart}-${chunkEnd} failed, resuming next scan:`, err);
      break;
    }

    const combined = [
      ...floorLogs.map((log) => ({ log, tier: 0, amountWei: log.args.amount as bigint, stockToken: log.args.stockToken as `0x${string}` })),
      ...wonLogs.map((log) => ({ log, tier: log.args.tier as number, amountWei: log.args.payout as bigint, stockToken: undefined as `0x${string}` | undefined })),
    ].sort((a, b) => {
      if (a.log.blockNumber !== b.log.blockNumber) return a.log.blockNumber! < b.log.blockNumber! ? -1 : 1;
      return a.log.logIndex! < b.log.logIndex! ? -1 : 1;
    });

    if (combined.length > 0) {
      let addedWei = 0n;
      const newEntries: DashboardWinEntry[] = [];

      for (const { log, tier, amountWei, stockToken } of combined) {
        const player = (log.args.player as string).toLowerCase() as `0x${string}`;
        addedWei += amountWei;

        newEntries.push({
          id: `${log.transactionHash}-${log.logIndex}`,
          player,
          tier,
          // Won doesn't carry stockToken; leaving it unset here rather than
          // cross-referencing Scratched (as the web hooks do) — the web
          // app's own onchain.ts falls back to SPY for an unrecognized
          // token anyway, and jackpot wins (the only case this affects)
          // always settle in SPY regardless.
          stockToken: stockToken ?? ("0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" as const),
          amountWei: amountWei.toString(),
          timestamp: await timestampFor(log.blockNumber!),
          txHash: log.transactionHash!,
        });

        const existing = state.players[player];
        if (existing) {
          existing.cardsScratched += 1;
          existing.totalWonWei = (BigInt(existing.totalWonWei) + amountWei).toString();
        } else {
          state.players[player] = { cardsScratched: 1, totalWonWei: amountWei.toString() };
        }
      }

      state.totalPaidOutWei = (BigInt(state.totalPaidOutWei) + addedWei).toString();
      state.wins = [...newEntries.reverse(), ...state.wins].slice(0, MAX_WINS);
    }

    state.lastScannedBlock = chunkEnd.toString();
    saveState();
    chunkStart = chunkEnd + 1n;
    if (chunkStart <= latest) await new Promise((resolve) => setTimeout(resolve, config.dashboardScanChunkDelayMs));
  }
}

export async function runDashboardCacheLoop(): Promise<void> {
  for (;;) {
    try {
      await Promise.all([refreshEthPrice(), refreshGameStats(), scanEvents()]);
      saveState();
    } catch (err) {
      console.error("[dashboard-cache] iteration failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.dashboardScanIntervalMs));
  }
}

export function getScoreboardSnapshot() {
  return {
    ethUsdPrice: state.ethUsdPrice,
    ethUsdPriceUpdatedAt: state.ethUsdPriceUpdatedAt,
    dailyCap: state.dailyCap,
    cardsSoldToday: state.cardsSoldToday,
    jackpotPotWei: state.jackpotPotWei,
    gameStatsUpdatedAt: state.gameStatsUpdatedAt,
    totalPaidOutWei: state.totalPaidOutWei,
    wins: state.wins,
  };
}

export function getLeaderboardSnapshot(): { players: DashboardPlayerAgg[] } {
  const players = Object.entries(state.players)
    .map(([player, agg]) => ({ player: player as `0x${string}`, cardsScratched: agg.cardsScratched, totalWonWei: agg.totalWonWei }))
    .sort((a, b) => {
      const diff = BigInt(a.totalWonWei) - BigInt(b.totalWonWei);
      return diff === 0n ? 0 : diff > 0n ? -1 : 1;
    })
    .slice(0, MAX_LEADERBOARD_ROWS);
  return { players };
}
