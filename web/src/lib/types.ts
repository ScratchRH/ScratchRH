export type CardType = "Penny" | "Classic" | "Premium";
export type Tier = "1x" | "2x" | "3x" | "4x" | "5x" | "10x" | "Jackpot" | "None";

export interface CardConfig {
  type: CardType;
  priceUsd: number;
  floorUsd: number;
  jackpotEntries: number;
}

export interface WinEntry {
  id: string;
  player: string;
  cardType: CardType;
  tier: Tier;
  amountUsd: number;
  stockSymbol: string;
  timestamp: number;
  txHash?: string; // unset for mock/demo-mode entries — only real chain data has one
}

export interface LeaderboardEntry {
  rank: number;
  player: string;
  cardsScratched: number;
  totalWonUsd: number;
}

export interface Holding {
  symbol: string;
  amountUsd: number;
}

export interface PlayerPortfolio {
  address: string;
  totalFloorWonUsd: number;
  totalInstantWonUsd: number;
  streak: number;
  cardsScratched: number;
  jackpotsHit: number;
  holdings: Holding[];
  history: WinEntry[];
}
