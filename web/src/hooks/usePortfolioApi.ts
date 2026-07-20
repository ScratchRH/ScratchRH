import { useEffect, useState } from "react";
import { KEEPER_API_URL } from "../lib/chain";
import type { Tier } from "../lib/types";
import { tierFromOnchain } from "../lib/onchain";

export interface PortfolioWinEntry {
  id: string;
  tier: Tier;
  stockToken: `0x${string}`;
  amountWei: bigint;
  timestamp: number;
  txHash: string;
}

export interface PortfolioData {
  totalFloorWonWei: bigint;
  totalInstantWonWei: bigint;
  cardsScratched: number;
  holdings: { stockToken: `0x${string}`; amountWei: bigint }[];
  history: PortfolioWinEntry[];
}

interface RawResponse {
  address: string;
  totalFloorWonWei: string;
  totalInstantWonWei: string;
  cardsScratched: number;
  holdings: { stockToken: `0x${string}`; amountWei: string }[];
  history: { id: string; tier: number; stockToken: `0x${string}`; amountWei: string; timestamp: number; txHash: string }[];
}

export type PortfolioLookupState = { phase: "idle" } | { phase: "loading" } | { phase: "error" } | { phase: "ready"; data: PortfolioData };

/// Looks up one player's real portfolio from the keeper's dashboard-cache
/// API (see keeper/src/portfolio.ts) — an on-demand indexed query, not a
/// pre-scanned cache like /api/scoreboard, since Portfolio is looked up one
/// address at a time rather than needing every player's full history kept
/// warm. Pass undefined to reset to idle (e.g. before any lookup happens).
export function usePortfolioApi(address: `0x${string}` | undefined): PortfolioLookupState {
  const [state, setState] = useState<PortfolioLookupState>({ phase: "idle" });

  useEffect(() => {
    if (!address || !KEEPER_API_URL) {
      setState({ phase: "idle" });
      return;
    }

    let cancelled = false;
    setState({ phase: "loading" });

    fetch(`${KEEPER_API_URL}/api/portfolio?address=${address}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RawResponse>;
      })
      .then((raw) => {
        if (cancelled) return;
        setState({
          phase: "ready",
          data: {
            totalFloorWonWei: BigInt(raw.totalFloorWonWei),
            totalInstantWonWei: BigInt(raw.totalInstantWonWei),
            cardsScratched: raw.cardsScratched,
            holdings: raw.holdings.map((h) => ({ stockToken: h.stockToken, amountWei: BigInt(h.amountWei) })),
            history: raw.history.map((h) => ({ ...h, tier: tierFromOnchain(h.tier), amountWei: BigInt(h.amountWei) })),
          },
        });
      })
      .catch((err) => {
        console.error("[usePortfolioApi] fetch failed:", err);
        if (!cancelled) setState({ phase: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}
