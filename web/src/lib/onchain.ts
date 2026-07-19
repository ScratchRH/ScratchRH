import { parseEther } from "viem";
import type { CardType, Tier } from "./types";

// Mirrors script/ScratchCore.s.sol's deck addresses (Robinhood Chain
// mainnet, chain id 4663) — keep these in sync if the deploy script's deck
// ever changes. Falls back to SPY (the jackpot/default token) for anything
// unrecognized rather than showing a raw address.
const STOCK_TOKEN_SYMBOLS: Record<string, string> = {
  "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C": "SPY",
  "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9": "AAPL",
  "0xe93237C50D904957Cf27E7B1133b510C669c2e74": "MSFT",
  "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC": "NVDA",
  "0x322F0929c4625eD5bAd873c95208D54E1c003b2d": "TSLA",
  "0x6330D8C3178a418788dF01a47479c0ce7CCF450b": "COIN",
  "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A": "PLTR",
};

export function symbolForStockToken(address: string): string {
  return STOCK_TOKEN_SYMBOLS[address] ?? "SPY";
}

// Index order matches ScratchCore's CardType/Tier enums exactly.
const ONCHAIN_CARD_TYPES: CardType[] = ["Penny", "Classic", "Premium"];
export function cardTypeFromOnchain(value: number): CardType {
  return ONCHAIN_CARD_TYPES[value] ?? "Penny";
}

const ONCHAIN_TIERS: Tier[] = ["None", "1x", "2x", "3x", "4x", "5x", "10x", "Jackpot"];
export function tierFromOnchain(value: number): Tier {
  return ONCHAIN_TIERS[value] ?? "None";
}

// Mirrors ScratchCore's cardConfigs prices exactly (src/ScratchCore.sol) —
// the receive() fallback infers CardType from one of these three exact
// values, so a real payment has to match to the wei.
export const CARD_PRICE_WEI: Record<CardType, bigint> = {
  Penny: parseEther("0.001"),
  Classic: parseEther("0.005"),
  Premium: parseEther("0.01"),
};

export function isLikelyAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}
