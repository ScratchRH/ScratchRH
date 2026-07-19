import type { CardConfig, CardType, LeaderboardEntry, PlayerPortfolio, Tier, WinEntry } from "./types";

// Mirrors SPEC.md's card lineup and instant-tier odds table. Swap this whole
// module for real RPC reads once ScratchCore is deployed (site stays
// read-only / no-wallet-connect per SPEC.md §5).
export const CARD_CONFIGS: CardConfig[] = [
  { type: "Penny", priceUsd: 1, floorUsd: 0.4, jackpotEntries: 0 },
  { type: "Classic", priceUsd: 5, floorUsd: 2, jackpotEntries: 1 },
  { type: "Premium", priceUsd: 10, floorUsd: 4, jackpotEntries: 2 },
];

export interface FundSplitSegment {
  label: string;
  bps: number;
  colorVar: string;
  note: string;
}

/** Mirrors ScratchCore's FLOOR_BPS / INSTANT_POOL_BPS / JACKPOT_BPS / RAKE_BPS — every ticket splits this way, locked into the contract at deploy. The 10% rake itself is split again 50/50 by RakeRouter's OPS_BPS / BUYBACK_BPS. */
export const FUND_SPLIT: FundSplitSegment[] = [
  { label: "Floor prize", bps: 4000, colorVar: "var(--green)", note: "Paid to you immediately as stock — every card wins this" },
  { label: "Instant pool", bps: 4000, colorVar: "var(--blue)", note: "Funds the tiered instant prizes" },
  { label: "Jackpot", bps: 1000, colorVar: "var(--purple)", note: "Rolls over — 30% stays in the pot even when it's hit" },
  { label: "Ops", bps: 500, colorVar: "var(--fg-dim)", note: "Keeps the lights on" },
  { label: "$SCRATCH buyback", bps: 500, colorVar: "var(--red)", note: "Market-buys $SCRATCH every sweep" },
];

/** Mirrors ScratchCore's DeckEntry weights (must sum to 10,000, same as the contract requires). */
interface DeckEntry {
  symbol: string;
  weightBps: number;
  chase?: boolean;
}

export const MYSTERY_DECK: DeckEntry[] = [
  { symbol: "SPY", weightBps: 7_000 },
  { symbol: "AAPL", weightBps: 1_000 },
  { symbol: "MSFT", weightBps: 1_000 },
  { symbol: "NVDA", weightBps: 600 },
  { symbol: "TSLA", weightBps: 250, chase: true },
  { symbol: "COIN", weightBps: 100, chase: true },
  { symbol: "PLTR", weightBps: 50, chase: true },
];

export function isChaseStock(symbol: string): boolean {
  return MYSTERY_DECK.find((d) => d.symbol === symbol)?.chase ?? false;
}

/** Same cumulative-weight pull ScratchCore._pullStock does on-chain, just over symbols instead of addresses. */
export function pullStock(): string {
  const roll = Math.floor(Math.random() * 10_000);
  let cumulative = 0;
  for (const entry of MYSTERY_DECK) {
    cumulative += entry.weightBps;
    if (roll < cumulative) return entry.symbol;
  }
  return MYSTERY_DECK[MYSTERY_DECK.length - 1].symbol;
}

// Rough mock share prices (USD) for share-denominated prize display only.
const MOCK_SHARE_PRICE_USD: Record<string, number> = {
  SPY: 640,
  AAPL: 235,
  MSFT: 470,
  NVDA: 145,
  TSLA: 260,
  COIN: 285,
  PLTR: 155,
  SLV: 32,
};

export function formatShareAmount(amountUsd: number, symbol: string): string {
  const price = MOCK_SHARE_PRICE_USD[symbol] ?? 100;
  const shares = amountUsd / price;
  if (shares < 0.001) return `${(shares * 1000).toFixed(2)}m ${symbol}`;
  return `${shares.toFixed(shares < 1 ? 4 : 2)} ${symbol}`;
}

export const TIER_ODDS_BPS: Record<Exclude<Tier, "None">, number> = {
  Jackpot: 1,
  "10x": 10,
  "5x": 40,
  "4x": 120,
  "3x": 350,
  "2x": 700,
  "1x": 1400,
};

const TIER_MULTIPLIER: Record<Exclude<Tier, "None" | "Jackpot">, number> = {
  "1x": 1,
  "2x": 2,
  "3x": 3,
  "4x": 4,
  "5x": 5,
  "10x": 10,
};

/** Same cumulative-threshold logic as ScratchCore._resolveTier, in bps out of 10,000. */
export function rollTier(jackpotEntries: number): Tier {
  const roll = Math.floor(Math.random() * 10_000);
  let threshold = 0;

  if (jackpotEntries > 0) {
    threshold += TIER_ODDS_BPS.Jackpot * jackpotEntries;
    if (roll < threshold) return "Jackpot";
  }
  threshold += TIER_ODDS_BPS["10x"];
  if (roll < threshold) return "10x";
  threshold += TIER_ODDS_BPS["5x"];
  if (roll < threshold) return "5x";
  threshold += TIER_ODDS_BPS["4x"];
  if (roll < threshold) return "4x";
  threshold += TIER_ODDS_BPS["3x"];
  if (roll < threshold) return "3x";
  threshold += TIER_ODDS_BPS["2x"];
  if (roll < threshold) return "2x";
  threshold += TIER_ODDS_BPS["1x"];
  if (roll < threshold) return "1x";
  return "None";
}

function randomAddress(seed: number): string {
  const hex = Math.abs(Math.sin(seed) * 1e16).toString(16).padStart(12, "0").slice(0, 12);
  return `0x${hex}...${hex.slice(-4)}`;
}

/** Same payout shape as ScratchCore._payInstant / scratch(): a tier win pays a
 * flat multiple of the ticket's own price, replacing the floor entirely
 * rather than adding to it. Jackpot is a separate pot, unrelated to price. */
export function tierPayoutUsd(tier: Tier, cardType: CardType): number {
  const config = CARD_CONFIGS.find((c) => c.type === cardType)!;
  if (tier === "None") return 0;
  if (tier === "Jackpot") return Math.round(5200 * 0.7);
  return config.priceUsd * TIER_MULTIPLIER[tier];
}

export function generateMockWins(count: number): WinEntry[] {
  const cardTypes: CardType[] = ["Penny", "Classic", "Classic", "Premium"];
  const wins: WinEntry[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const cardType = cardTypes[i % cardTypes.length];
    const config = CARD_CONFIGS.find((c) => c.type === cardType)!;
    const tier = rollTier(config.jackpotEntries);
    // Jackpot always settles in SPY on-chain, regardless of the ticket's mystery pull.
    const stockSymbol = tier === "Jackpot" ? "SPY" : pullStock();
    wins.push({
      id: `win-${i}`,
      player: randomAddress((i + 1) * 7.13),
      cardType,
      tier,
      // A tier/jackpot win replaces the floor payout entirely (mutually exclusive).
      amountUsd: tier === "None" ? config.floorUsd : tierPayoutUsd(tier, cardType),
      stockSymbol,
      timestamp: now - i * 42_000,
    });
  }
  return wins;
}

export const LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, player: "0x8f3a...92c1", streak: 47, cardsScratched: 312, totalWonUsd: 1840 },
  { rank: 2, player: "0x1b7e...4f0a", streak: 33, cardsScratched: 201, totalWonUsd: 1120 },
  { rank: 3, player: "0xcafe...beef", streak: 29, cardsScratched: 188, totalWonUsd: 940 },
  { rank: 4, player: "0x4d2c...77aa", streak: 21, cardsScratched: 156, totalWonUsd: 705 },
  { rank: 5, player: "0x9e01...33dd", streak: 18, cardsScratched: 140, totalWonUsd: 610 },
];

export const SAMPLE_PORTFOLIOS: Record<string, PlayerPortfolio> = {
  "0xcafe...beef": {
    address: "0xcafe...beef",
    totalFloorWonUsd: 412,
    totalInstantWonUsd: 88,
    streak: 29,
    cardsScratched: 188,
    jackpotsHit: 0,
    holdings: [
      { symbol: "SPY", amountUsd: 320 },
      { symbol: "NVDA", amountUsd: 110 },
      { symbol: "SLV", amountUsd: 70 },
    ],
    history: generateMockWins(12),
  },
};

export const GLOBAL_STATS = {
  jackpotPotUsd: 5240,
  totalStockPaidOutUsd: 284_600,
  dailyCap: 1000,
  cardsSoldToday: 617,
};
