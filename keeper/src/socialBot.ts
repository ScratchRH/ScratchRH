import { config, xCredentialsConfigured } from "./config.js";

const TIER_NAMES = ["None", "Common", "Uncommon", "Rare", "Epic", "Jackpot"] as const;

export interface WinEvent {
  ticketId: bigint;
  player: `0x${string}`;
  tier: number; // ScratchCore.Tier enum index
  payout: bigint; // raw stock-token units
  stockToken: `0x${string}`;
  isJackpot: boolean;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/// Jackpots always post; everything else needs to be Epic+ to be worth a
/// tweet. Revisit once there's a price feed to gate on actual USD value
/// instead of tier.
function isTweetWorthy(event: WinEvent): boolean {
  if (event.isJackpot) return true;
  return event.tier >= TIER_NAMES.indexOf("Epic");
}

function formatTweet(event: WinEvent): string {
  const tierName = TIER_NAMES[event.tier] ?? "Unknown";
  if (event.isJackpot) {
    return `JACKPOT 🎰 ${shortenAddress(event.player)} just hit the SCRATCH jackpot. Ticket #${event.ticketId}.`;
  }
  return `${tierName} pull 🍀 ${shortenAddress(event.player)} just won on SCRATCH. Ticket #${event.ticketId}.`;
}

async function postToX(text: string): Promise<void> {
  if (!xCredentialsConfigured()) {
    console.log(`[social-bot] (stub, no X credentials configured) would tweet: "${text}"`);
    return;
  }
  const { TwitterApi } = await import("twitter-api-v2");
  const client = new TwitterApi({
    appKey: config.x.apiKey,
    appSecret: config.x.apiSecret,
    accessToken: config.x.accessToken,
    accessSecret: config.x.accessSecret,
  });
  await client.v2.tweet(text);
}

export async function maybePostWin(event: WinEvent): Promise<void> {
  if (!isTweetWorthy(event)) return;
  await postToX(formatTweet(event));
}
