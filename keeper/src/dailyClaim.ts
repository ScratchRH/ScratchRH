import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEther } from "viem";
import { publicClient, walletClient } from "./chain.js";
import { config } from "./config.js";
import { erc20Abi } from "./abi.js";

// Same wei amounts as web/src/lib/onchain.ts's CARD_PRICE_WEI — duplicated
// rather than shared, same reasoning as every other cross-service constant
// in this codebase (keeper and web deploy separately).
const PENNY_PRICE_WEI = parseEther("0.00054");
const CLASSIC_PRICE_WEI = parseEther("0.0027");

// Holding thresholds as basis points of $SCRATCH total supply. Classic is
// checked first since it's the higher bar — an address past it also clears
// Penny's, and should get the better tier, not the lower one.
// Basis points: 1 bps = 0.01%, so 1.2% = 120 bps and 0.5% = 50 bps — NOT
// 1200/500, which would actually be 12%/5%. Caught this exact mistake
// locally against a real ~1.03%-of-supply holder before shipping it.
const CLASSIC_THRESHOLD_BPS = 120n; // 1.2%
const PENNY_THRESHOLD_BPS = 50n; // 0.5%

export type ClaimTier = "Penny" | "Classic";

interface ClaimState {
  // address (lowercased) -> UTC date string (YYYY-MM-DD) of last claim
  lastClaimedDate: Record<string, string>;
}

function loadState(): ClaimState {
  if (!existsSync(config.dailyClaimFile)) return { lastClaimedDate: {} };
  try {
    return { lastClaimedDate: {}, ...JSON.parse(readFileSync(config.dailyClaimFile, "utf8")) };
  } catch (err) {
    console.error("[daily-claim] failed to load state file, starting fresh:", err);
    return { lastClaimedDate: {} };
  }
}

function saveState(state: ClaimState): void {
  try {
    writeFileSync(config.dailyClaimFile, JSON.stringify(state));
  } catch (err) {
    console.error("[daily-claim] failed to persist state file:", err);
  }
}

const state = loadState();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ClaimStatus {
  eligible: boolean;
  tier: ClaimTier | null;
  alreadyClaimedToday: boolean;
}

/// Read-only — lets the frontend show eligibility/claim status before
/// spending any gas, without touching the claim-tracking state at all.
export async function getClaimStatus(address: `0x${string}`): Promise<ClaimStatus> {
  const tier = await eligibleTier(address);
  return {
    eligible: tier !== null,
    tier,
    alreadyClaimedToday: state.lastClaimedDate[address.toLowerCase()] === todayUtc(),
  };
}

// $SCRATCH's burn mechanism routes burned tokens to the conventional
// 0x...dEaD sink (confirmed while building the Flywheel burn-tracking
// stat) rather than truly destroying them, so it accumulates a real,
// large balance over time — 1%+ of supply already. Nobody holds its
// private key, so it can never actually claim, but excluding it here
// avoids a confusing "eligible" status for an address nothing can act on.
const EXCLUDED_ADDRESSES = new Set([
  `0x${"0".repeat(36)}dead`, // the conventional burn sink — built from a repeat() rather than typed out, after mistyping its zero-count by hand twice already this session
  `0x${"0".repeat(40)}`,
]);

async function eligibleTier(address: `0x${string}`): Promise<ClaimTier | null> {
  if (!config.scratchTokenAddress) return null;
  if (EXCLUDED_ADDRESSES.has(address.toLowerCase())) return null;
  const [balance, totalSupply] = await Promise.all([
    publicClient.readContract({ address: config.scratchTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    publicClient.readContract({ address: config.scratchTokenAddress, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  if (totalSupply === 0n) return null;
  const bps = (balance * 10_000n) / totalSupply;
  if (bps >= CLASSIC_THRESHOLD_BPS) return "Classic";
  if (bps >= PENNY_THRESHOLD_BPS) return "Penny";
  return null;
}

export interface ClaimResult {
  tier: ClaimTier;
  amountWei: string;
  txHash: `0x${string}`;
}

export class ClaimError extends Error {}

/// Re-verifies eligibility and claim status server-side (never trusts a
/// client-supplied tier) and, if clear, sends the claimant exactly that
/// tier's card price in ETH from the keeper's own wallet — a plain
/// transfer, not a contract call, since ScratchCore.buy()'s ticket
/// ownership is hardcoded to msg.sender and can't be assigned to a third
/// party. The claimant has to call buy() themselves afterward with the
/// ETH they just received; this only handles the funding half.
export async function claimDailyFree(address: `0x${string}`): Promise<ClaimResult> {
  if (!config.scratchTokenAddress) throw new ClaimError("Daily claim isn't live yet.");

  const key = address.toLowerCase();
  const today = todayUtc();
  if (state.lastClaimedDate[key] === today) {
    throw new ClaimError("Already claimed today — come back after 00:00 UTC.");
  }

  const tier = await eligibleTier(address);
  if (!tier) {
    throw new ClaimError("Not enough $SCRATCH held — need 0.5% of supply for Penny, 1.2% for Classic.");
  }

  const amountWei = tier === "Classic" ? CLASSIC_PRICE_WEI : PENNY_PRICE_WEI;

  // Recorded before sending, not after — if the transfer fails partway (or
  // the process crashes right after broadcasting) this fails safe toward
  // "can't claim today" rather than toward "can double-claim by retrying."
  state.lastClaimedDate[key] = today;
  saveState(state);

  try {
    const txHash = await walletClient.sendTransaction({ to: address, value: amountWei });
    return { tier, amountWei: amountWei.toString(), txHash };
  } catch (err) {
    // Genuinely failed to send — undo the claim record so they can retry.
    delete state.lastClaimedDate[key];
    saveState(state);
    throw err;
  }
}
