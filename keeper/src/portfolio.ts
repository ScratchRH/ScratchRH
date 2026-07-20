import { dashboardPublicClient as publicClient } from "./chain.js";
import { config } from "./config.js";
import { floorPaidEvent, wonEvent } from "./abi.js";
import { SCRATCH_CORE_DEPLOY_BLOCK } from "./dashboardCache.js";

const CACHE_TTL_MS = 20_000; // short-lived, just enough to survive a page's own poll interval
const MAX_HISTORY = 40;

export interface PortfolioWinEntry {
  id: string;
  tier: number;
  stockToken: `0x${string}`;
  amountWei: string;
  timestamp: number;
  txHash: string;
}

export interface PortfolioSnapshot {
  address: `0x${string}`;
  totalFloorWonWei: string;
  totalInstantWonWei: string;
  cardsScratched: number;
  holdings: { stockToken: `0x${string}`; amountWei: string }[];
  history: PortfolioWinEntry[]; // newest first, capped at MAX_HISTORY
}

const cache = new Map<string, { snapshot: PortfolioSnapshot; fetchedAt: number }>();

// player is an indexed topic on both events, so this is a targeted query —
// not a full-history scan like dashboardCache.ts's — cheap enough to run
// live per request rather than needing its own background loop.
export async function getPortfolio(address: `0x${string}`): Promise<PortfolioSnapshot> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.snapshot;

  // Both cores queried in one call each (viem's getLogs accepts an address
  // array) — Whale's own deploy block is later than SCRATCH_CORE_DEPLOY_BLOCK,
  // but scanning the extra empty range for it costs nothing beyond the one
  // request; still player-indexed, so this stays a targeted query either way.
  const addresses = config.whaleScratchCoreAddress ? [config.scratchCoreAddress, config.whaleScratchCoreAddress] : [config.scratchCoreAddress];
  const latest = await publicClient.getBlockNumber();
  const [floorLogs, wonLogs] = await Promise.all([
    publicClient.getLogs({
      address: addresses,
      event: floorPaidEvent,
      args: { player: address },
      fromBlock: SCRATCH_CORE_DEPLOY_BLOCK,
      toBlock: latest,
    }),
    publicClient.getLogs({
      address: addresses,
      event: wonEvent,
      args: { player: address },
      fromBlock: SCRATCH_CORE_DEPLOY_BLOCK,
      toBlock: latest,
    }),
  ]);

  const combined = [
    ...floorLogs.map((log) => ({ log, tier: 0, amountWei: log.args.amount as bigint, stockToken: log.args.stockToken as `0x${string}` })),
    ...wonLogs.map((log) => ({ log, tier: log.args.tier as number, amountWei: log.args.payout as bigint, stockToken: undefined as `0x${string}` | undefined })),
  ].sort((a, b) => {
    if (a.log.blockNumber !== b.log.blockNumber) return a.log.blockNumber! < b.log.blockNumber! ? -1 : 1;
    return a.log.logIndex! < b.log.logIndex! ? -1 : 1;
  });

  let totalFloorWonWei = 0n;
  let totalInstantWonWei = 0n;
  const holdingsByToken = new Map<string, bigint>();
  const history: PortfolioWinEntry[] = [];
  const blockTimestampCache = new Map<bigint, number>();

  async function timestampFor(blockNumber: bigint): Promise<number> {
    const c = blockTimestampCache.get(blockNumber);
    if (c !== undefined) return c;
    const block = await publicClient.getBlock({ blockNumber });
    const ms = Number(block.timestamp) * 1000;
    blockTimestampCache.set(blockNumber, ms);
    return ms;
  }

  for (const { log, tier, amountWei, stockToken } of combined) {
    if (tier === 0) totalFloorWonWei += amountWei;
    else totalInstantWonWei += amountWei;

    // Jackpot wins (the only case Won doesn't carry stockToken for) always
    // settle in SPY — same fallback dashboardCache.ts uses.
    const token = stockToken ?? ("0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" as const);
    holdingsByToken.set(token, (holdingsByToken.get(token) ?? 0n) + amountWei);

    history.push({
      id: `${log.transactionHash}-${log.logIndex}`,
      tier,
      stockToken: token,
      amountWei: amountWei.toString(),
      timestamp: await timestampFor(log.blockNumber!),
      txHash: log.transactionHash!,
    });
  }

  const snapshot: PortfolioSnapshot = {
    address,
    totalFloorWonWei: totalFloorWonWei.toString(),
    totalInstantWonWei: totalInstantWonWei.toString(),
    cardsScratched: combined.length,
    holdings: [...holdingsByToken.entries()].map(([stockToken, amountWei]) => ({ stockToken: stockToken as `0x${string}`, amountWei: amountWei.toString() })),
    history: history.reverse().slice(0, MAX_HISTORY),
  };

  cache.set(key, { snapshot, fetchedAt: Date.now() });
  return snapshot;
}
