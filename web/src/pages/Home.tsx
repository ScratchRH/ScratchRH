import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { JackpotTicker } from "../components/JackpotTicker";
import { StatTile } from "../components/StatTile";
import { WinsFeed } from "../components/WinsFeed";
import { GLOBAL_STATS, generateMockWins, pullStock, rollTier } from "../lib/mockData";
import { formatCountdown, msUntilNextUtcMidnight } from "../lib/gamification";
import { formatUsd, truncateAddress } from "../lib/format";
import { KEEPER_API_URL } from "../lib/chain";
import { symbolForStockToken } from "../lib/onchain";
import { useScoreboardApi } from "../hooks/useScoreboardApi";
import type { WinEntry } from "../lib/types";

// On the moment the keeper's dashboard-cache API is configured, off
// otherwise (local dev with no .env, or the keeper not deployed yet).
const REAL_MODE = Boolean(KEEPER_API_URL);

function useRestockCountdown(): string {
  const [remaining, setRemaining] = useState(() => msUntilNextUtcMidnight());

  useEffect(() => {
    const interval = setInterval(() => setRemaining(msUntilNextUtcMidnight()), 1000);
    return () => clearInterval(interval);
  }, []);

  return formatCountdown(remaining);
}

export function Home() {
  // --- demo-mode-only state ---
  const [mockWins, setMockWins] = useState<WinEntry[]>(() => generateMockWins(18));
  const [mockJackpotUsd, setMockJackpotUsd] = useState(GLOBAL_STATS.jackpotPotUsd);
  const [mockInstantPoolUsd, setMockInstantPoolUsd] = useState(GLOBAL_STATS.instantPoolUsd);
  const [mockTotalPaidOutUsd, setMockTotalPaidOutUsd] = useState(GLOBAL_STATS.totalStockPaidOutUsd);

  const countdown = useRestockCountdown();

  // --- real-mode-only state ---
  const scoreboard = useScoreboardApi();

  useEffect(() => {
    if (REAL_MODE) return;
    const interval = setInterval(() => {
      setMockWins((prev) => {
        const tier = rollTier(1);
        const amountUsd = tier === "None" ? 2 : 2 + Math.random() * 40;
        const next: WinEntry = {
          id: `live-${Date.now()}`,
          player: `0x${Math.random().toString(16).slice(2, 8)}...${Math.random().toString(16).slice(2, 6)}`,
          cardType: "Classic",
          tier,
          amountUsd,
          // Jackpot always settles in SPY on-chain, regardless of the ticket's mystery pull.
          stockSymbol: tier === "Jackpot" ? "SPY" : pullStock(),
          timestamp: Date.now(),
        };
        setMockTotalPaidOutUsd((prevTotal) => prevTotal + amountUsd);
        return [next, ...prev].slice(0, 40);
      });
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // The jackpot and instant pool are real stock exposure that grows from
  // rake even when nobody's actively playing — tick them up independent of
  // the wins feed.
  useEffect(() => {
    if (REAL_MODE) return;
    const interval = setInterval(() => {
      setMockJackpotUsd((prev) => prev + 0.5 + Math.random() * 2.5);
      setMockInstantPoolUsd((prev) => prev + 0.5 + Math.random() * 2.5);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const realWins: WinEntry[] = useMemo(() => {
    if (!scoreboard || scoreboard.ethUsdPrice === undefined) return [];
    const ethUsdPrice = scoreboard.ethUsdPrice;
    return scoreboard.wins.map((entry) => ({
      id: entry.id,
      player: truncateAddress(entry.player),
      cardType: "Penny", // unused by WinsFeed's rendering — only tier/player/stockSymbol/amount/time are shown
      tier: entry.tier,
      amountUsd: Number(formatEther(entry.amountWei)) * ethUsdPrice,
      stockSymbol: symbolForStockToken(entry.stockToken),
      timestamp: entry.timestamp,
      txHash: entry.txHash,
    }));
  }, [scoreboard]);

  const wins = REAL_MODE ? realWins : mockWins;

  const jackpotUsd = REAL_MODE
    ? scoreboard?.jackpotPotWei !== undefined && scoreboard.ethUsdPrice !== undefined
      ? Number(formatEther(scoreboard.jackpotPotWei)) * scoreboard.ethUsdPrice
      : 0
    : mockJackpotUsd;

  const instantPoolLabel = REAL_MODE
    ? scoreboard?.instantPoolWei === undefined || scoreboard.ethUsdPrice === undefined
      ? "…"
      : formatUsd(Number(formatEther(scoreboard.instantPoolWei)) * scoreboard.ethUsdPrice)
    : formatUsd(mockInstantPoolUsd);

  // Jackpot + instant pool combined — both already sum across every live
  // ScratchCore (main + Whale) via the keeper's dashboard-cache, so this is
  // genuinely "everything currently up for grabs," not just the main game's cut.
  const combinedPoolLabel = REAL_MODE
    ? scoreboard?.instantPoolWei === undefined || scoreboard?.jackpotPotWei === undefined || scoreboard.ethUsdPrice === undefined
      ? "…"
      : formatUsd(
          (Number(formatEther(scoreboard.instantPoolWei)) + Number(formatEther(scoreboard.jackpotPotWei))) * scoreboard.ethUsdPrice,
        )
    : formatUsd(mockInstantPoolUsd + mockJackpotUsd);

  const totalPaidOutLabel = REAL_MODE
    ? !scoreboard || scoreboard.ethUsdPrice === undefined
      ? "…"
      : formatUsd(Number(formatEther(scoreboard.totalPaidOutWei)) * scoreboard.ethUsdPrice)
    : formatUsd(mockTotalPaidOutUsd);

  const cardsRemaining = REAL_MODE
    ? scoreboard?.dailyCap !== undefined && scoreboard.cardsSoldToday !== undefined
      ? Number(scoreboard.dailyCap - scoreboard.cardsSoldToday)
      : undefined
    : GLOBAL_STATS.dailyCap - GLOBAL_STATS.cardsSoldToday;

  const dailyCapLabel = REAL_MODE
    ? scoreboard?.dailyCap !== undefined
      ? scoreboard.dailyCap.toLocaleString()
      : "…"
    : GLOBAL_STATS.dailyCap.toLocaleString();

  return (
    <div className="stack">
      <h1 className="page-title">Scoreboard</h1>

      <JackpotTicker valueUsd={jackpotUsd} />

      <div className="grid grid-stats">
        <StatTile
          label="Total Stock Paid Out"
          value={totalPaidOutLabel}
          sub="Cumulative floor + instant + jackpot"
          accent
        />
        <StatTile label="Total Prize Pool" value={combinedPoolLabel} sub="Instant pool + jackpot, combined" accent />
        <StatTile label="Instant Pool" value={instantPoolLabel} sub="Funds the 1x-10x instant-win tiers" accent />
        <StatTile
          label="Cards Remaining Today"
          value={cardsRemaining === undefined ? "…" : cardsRemaining.toLocaleString()}
          sub={`of ${dailyCapLabel} daily cap`}
        />
        <StatTile label="Next Restock" value={countdown} sub="fresh cards at UTC midnight" />
      </div>

      <div className="panel">
        <div className="panel-title">
          <span>Live Wins</span>
          <span>updating live</span>
        </div>
        <WinsFeed wins={wins} />
      </div>
    </div>
  );
}
