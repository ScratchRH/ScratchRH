import { parseEventLogs, type Log, type TransactionReceipt } from "viem";
import { config } from "./config.js";
import { publicClient, walletClient } from "./chain.js";
import { scratchCoreAbi, boughtEvent, randomnessAbi } from "./abi.js";
import { loadState, saveState, type KeeperState } from "./state.js";
import { maybePostWin } from "./socialBot.js";
import { maybeSweep } from "./taxSweeper.js";

const TIER_JACKPOT = 5;

/// One entry per live ScratchCore — always the main $1/$5/$10 game, plus the
/// $30 WHALE core once WHALE_SCRATCH_CORE_ADDRESS is set (see config.ts). Each
/// core gets its own state file since ticket IDs restart at 1 per contract
/// and aren't comparable across them.
export interface Core {
  label: string;
  scratchCoreAddress: `0x${string}`;
  randomnessAddress: `0x${string}`;
  stateFile: string;
}

function cores(): Core[] {
  const list: Core[] = [
    { label: "main", scratchCoreAddress: config.scratchCoreAddress, randomnessAddress: config.randomnessAddress, stateFile: config.stateFile },
  ];
  if (config.whaleScratchCoreAddress && config.whaleRandomnessAddress) {
    list.push({
      label: "whale",
      scratchCoreAddress: config.whaleScratchCoreAddress,
      randomnessAddress: config.whaleRandomnessAddress,
      stateFile: config.whaleStateFile,
    });
  }
  return list;
}

// abi.ts's exports are readonly tuples (`as const`), not plain `Abi`, so
// parseEventLogs's generics don't line up cleanly here — decode into this
// minimal shape instead of fighting them.
type DecodedLog = Log & { eventName: string; args: Record<string, unknown> };
function decodeLogs(abi: unknown, logs: Log[]): DecodedLog[] {
  return parseEventLogs({ abi: abi as [], logs }) as unknown as DecodedLog[];
}

function emptyState(startBlock: bigint): KeeperState {
  return {
    lastProcessedBlock: startBlock.toString(),
    pendingTicketIds: [],
    warnedExpiredTicketIds: [],
  };
}

export async function initState(core: Core): Promise<KeeperState> {
  const existing = loadState(core.stateFile);
  if (existing) return existing;

  const latest = await publicClient.getBlockNumber();
  const start = latest > config.buyLookbackBlocks ? latest - config.buyLookbackBlocks : 0n;
  return emptyState(start);
}

/// Scans for new Bought events since the last checkpoint and adds them to the
/// pending queue. Chunked at config.logsChunkSize rather than one
/// fromBlock->toBlock call spanning the whole gap — free-tier RPC providers
/// (Alchemy's is 10 blocks) reject a wider eth_getLogs range outright, and
/// on first run that gap is the full BUY_LOOKBACK_BLOCKS. Each chunk's
/// result is folded into the running state immediately, not just returned
/// at the end, so a later chunk failing (rate limit, transient network
/// error) doesn't discard progress already made this call — the next poll
/// just resumes from lastProcessedBlock rather than re-scanning from
/// scratch or, worse, getting stuck re-requesting the same too-wide range
/// forever (that was the actual bug: a failed call never reached
/// saveState(), so lastProcessedBlock stayed pinned while toBlock kept
/// growing every poll, guaranteeing every future call was equally too wide).
async function pollForNewTickets(core: Core, state: KeeperState): Promise<KeeperState> {
  const toBlock = await publicClient.getBlockNumber();
  let lastProcessedBlock = BigInt(state.lastProcessedBlock);
  let chunkStart = lastProcessedBlock + 1n;
  if (chunkStart > toBlock) return state;

  const pending = new Set(state.pendingTicketIds);

  while (chunkStart <= toBlock) {
    const chunkEnd = chunkStart + config.logsChunkSize - 1n < toBlock ? chunkStart + config.logsChunkSize - 1n : toBlock;

    let logs;
    try {
      logs = await publicClient.getLogs({
        address: core.scratchCoreAddress,
        event: boughtEvent,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      });
    } catch (err) {
      console.error(
        `[reveal-watcher:${core.label}] getLogs ${chunkStart}-${chunkEnd} failed, resuming next poll: ${(err as Error).message.split("\n")[0]}`,
      );
      break;
    }

    const decoded = decodeLogs(scratchCoreAbi, logs);
    for (const log of decoded) {
      if (log.eventName === "Bought") pending.add((log.args.ticketId as bigint).toString());
    }

    lastProcessedBlock = chunkEnd;
    chunkStart = chunkEnd + 1n;
    if (chunkStart <= toBlock) await new Promise((resolve) => setTimeout(resolve, config.logsChunkDelayMs));
  }

  return { ...state, lastProcessedBlock: lastProcessedBlock.toString(), pendingTicketIds: [...pending] };
}

function extractWin(ticketId: bigint, receipt: TransactionReceipt) {
  const decoded = decodeLogs(scratchCoreAbi, receipt.logs as Log[]);
  const scratched = decoded.find((log) => log.eventName === "Scratched");
  const won = decoded.find((log) => log.eventName === "Won");
  if (!scratched || !won) return null;

  const stockToken = scratched.args.stockToken as `0x${string}`;
  const player = won.args.player as `0x${string}`;
  const payout = won.args.payout as bigint;
  const tierNum = Number(won.args.tier as number | bigint);

  return {
    ticketId,
    player,
    tier: tierNum,
    payout,
    stockToken,
    isJackpot: tierNum === TIER_JACKPOT,
  };
}

/// Attempts to crank each pending ticket's reveal. Tickets already scratched
/// by another keeper, or not yet revealable, are left alone (or dropped, if
/// already scratched). Tickets whose blockhash expired can't currently be
/// rerolled — ScratchCore doesn't expose a passthrough to
/// Randomness.reroll (onlyConsumer) — so we just warn once and leave them
/// stuck pending a contract-level fix.
async function processPendingTickets(core: Core, state: KeeperState): Promise<KeeperState> {
  const stillPending: string[] = [];
  const warnedExpired = new Set(state.warnedExpiredTicketIds);

  for (const idStr of state.pendingTicketIds) {
    const ticketId = BigInt(idStr);

    const revealable = await publicClient.readContract({
      address: core.randomnessAddress,
      abi: randomnessAbi,
      functionName: "isRevealable",
      args: [ticketId],
    });

    if (!revealable) {
      // isRevealable/isExpired both require !fulfilled, so a ticket someone
      // else already resolved (another keeper instance racing, or manual
      // intervention) reads as neither revealable nor expired — check
      // fulfilled explicitly, or a resolved ticket sits in pendingTicketIds
      // forever, re-checked (and re-persisted) every single poll.
      const [, fulfilled] = await publicClient.readContract({
        address: core.randomnessAddress,
        abi: randomnessAbi,
        functionName: "requests",
        args: [ticketId],
      });
      if (fulfilled) continue;

      const expired = await publicClient.readContract({
        address: core.randomnessAddress,
        abi: randomnessAbi,
        functionName: "isExpired",
        args: [ticketId],
      });
      if (expired && !warnedExpired.has(idStr)) {
        console.warn(`[reveal-watcher:${core.label}] ticket ${idStr} blockhash expired and cannot be rerolled — stuck.`);
        warnedExpired.add(idStr);
      }
      stillPending.push(idStr);
      continue;
    }

    try {
      const { request } = await publicClient.simulateContract({
        account: walletClient.account,
        address: core.scratchCoreAddress,
        abi: scratchCoreAbi,
        functionName: "scratch",
        args: [ticketId],
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      console.log(`[reveal-watcher:${core.label}] scratched ticket ${idStr} (tx ${hash})`);

      const win = extractWin(ticketId, receipt);
      if (win && win.payout > 0n) await maybePostWin(win);
    } catch (err) {
      // Most likely: another keeper already scratched this ticket first.
      // Permissionless cranking means that's an expected race, not a bug.
      console.log(`[reveal-watcher:${core.label}] skipping ticket ${idStr}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  return { ...state, pendingTicketIds: stillPending, warnedExpiredTicketIds: [...warnedExpired] };
}

export async function runOnce(core: Core, state: KeeperState): Promise<KeeperState> {
  const afterPoll = await pollForNewTickets(core, state);
  const afterProcess = await processPendingTickets(core, afterPoll);
  saveState(core.stateFile, afterProcess);
  return afterProcess;
}

export async function runForever(): Promise<void> {
  const activeCores = cores();
  const states = new Map<string, KeeperState>();
  for (const core of activeCores) states.set(core.label, await initState(core));

  console.log(`[reveal-watcher] watching ${activeCores.length} core(s): ${activeCores.map((c) => c.label).join(", ")}`);

  let lastSweepCheckAt = 0;
  for (;;) {
    for (const core of activeCores) {
      try {
        states.set(core.label, await runOnce(core, states.get(core.label)!));
      } catch (err) {
        console.error(`[reveal-watcher:${core.label}] iteration failed:`, err);
      }
    }
    try {
      lastSweepCheckAt = await maybeSweep(lastSweepCheckAt);
    } catch (err) {
      console.error("[tax-sweeper] iteration failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}
