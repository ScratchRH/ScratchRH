import { parseEventLogs, type Log, type TransactionReceipt } from "viem";
import { config } from "./config.js";
import { publicClient, walletClient } from "./chain.js";
import { scratchCoreAbi, boughtEvent, randomnessAbi } from "./abi.js";
import { loadState, saveState, type KeeperState } from "./state.js";
import { maybePostWin } from "./socialBot.js";
import { maybeSweep } from "./taxSweeper.js";

const TIER_JACKPOT = 5;

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

export async function initState(): Promise<KeeperState> {
  const existing = loadState(config.stateFile);
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
async function pollForNewTickets(state: KeeperState): Promise<KeeperState> {
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
        address: config.scratchCoreAddress,
        event: boughtEvent,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      });
    } catch (err) {
      console.error(
        `[reveal-watcher] getLogs ${chunkStart}-${chunkEnd} failed, resuming next poll: ${(err as Error).message.split("\n")[0]}`,
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
async function processPendingTickets(state: KeeperState): Promise<KeeperState> {
  const stillPending: string[] = [];
  const warnedExpired = new Set(state.warnedExpiredTicketIds);

  for (const idStr of state.pendingTicketIds) {
    const ticketId = BigInt(idStr);

    const revealable = await publicClient.readContract({
      address: config.randomnessAddress,
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
        address: config.randomnessAddress,
        abi: randomnessAbi,
        functionName: "requests",
        args: [ticketId],
      });
      if (fulfilled) continue;

      const expired = await publicClient.readContract({
        address: config.randomnessAddress,
        abi: randomnessAbi,
        functionName: "isExpired",
        args: [ticketId],
      });
      if (expired && !warnedExpired.has(idStr)) {
        console.warn(`[reveal-watcher] ticket ${idStr} blockhash expired and cannot be rerolled — stuck.`);
        warnedExpired.add(idStr);
      }
      stillPending.push(idStr);
      continue;
    }

    try {
      const { request } = await publicClient.simulateContract({
        account: walletClient.account,
        address: config.scratchCoreAddress,
        abi: scratchCoreAbi,
        functionName: "scratch",
        args: [ticketId],
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      console.log(`[reveal-watcher] scratched ticket ${idStr} (tx ${hash})`);

      const win = extractWin(ticketId, receipt);
      if (win && win.payout > 0n) await maybePostWin(win);
    } catch (err) {
      // Most likely: another keeper already scratched this ticket first.
      // Permissionless cranking means that's an expected race, not a bug.
      console.log(`[reveal-watcher] skipping ticket ${idStr}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  return { ...state, pendingTicketIds: stillPending, warnedExpiredTicketIds: [...warnedExpired] };
}

export async function runOnce(state: KeeperState): Promise<KeeperState> {
  const afterPoll = await pollForNewTickets(state);
  const afterProcess = await processPendingTickets(afterPoll);
  saveState(config.stateFile, afterProcess);
  return afterProcess;
}

export async function runForever(): Promise<void> {
  let state = await initState();
  let lastSweepCheckAt = 0;
  for (;;) {
    try {
      state = await runOnce(state);
    } catch (err) {
      console.error("[reveal-watcher] iteration failed:", err);
    }
    try {
      lastSweepCheckAt = await maybeSweep(lastSweepCheckAt);
    } catch (err) {
      console.error("[tax-sweeper] iteration failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}
