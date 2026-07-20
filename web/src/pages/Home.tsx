import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { JackpotTicker } from "../components/JackpotTicker";
import { StatTile } from "../components/StatTile";
import { WinsFeed } from "../components/WinsFeed";
import { GLOBAL_STATS, generateMockWins, pullStock, rollTier } from "../lib/mockData";
import { formatCountdown, msUntilNextUtcMidnight } from "../lib/gamification";
import { formatUsd, truncateAddress } from "../lib/format";
import { SCRATCH_CORE_ADDRESS } from "../lib/chain";
import { useEthUsdPrice } from "../lib/ethPrice";
import { useGameStats } from "../hooks/useGameStats";
import { useWinsFeed } from "../hooks/useWinsFeed";
import type { WinEntry } from "../lib/types";

// Same real-mode switch Play.tsx uses — on the moment ScratchCore is
// actually deployed, off otherwise (local dev with no .env, or contracts
// not live yet).
const REAL_MODE = Boolean(SCRATCH_CORE_ADDRESS);

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
  const [mockTotalPaidOutUsd, setMockTotalPaidOutUsd] = useState(GLOBAL_STATS.totalStockPaidOutUsd);

  const countdown = useRestockCountdown();

  // --- real-mode-only state ---
  const ethUsdPrice = useEthUsdPrice();
  const gameStats = useGameStats();
  const winsFeed = useWinsFeed();

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

  // The jackpot is real S&P 500 exposure that grows from rake even when
  // nobody's actively playing — tick it up independent of the wins feed.
  useEffect(() => {
    if (REAL_MODE) return;
    const interval = setInterval(() => {
      setMockJackpotUsd((prev) => prev + 0.5 + Math.random() * 2.5);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Raw wei -> USD only once a live ETH price has actually loaded, so this
  // doesn't flash "$0" on every mount before settling on the real number.
  const realWins: WinEntry[] = useMemo(() => {
    if (ethUsdPrice === undefined) return [];
    return winsFeed.entries.map((entry) => ({
      id: entry.id,
      player: truncateAddress(entry.player),
      cardType: "Penny", // unused by WinsFeed's rendering — only tier/player/stockSymbol/amount/time are shown
      tier: entry.tier,
      amountUsd: Number(formatEther(entry.amountWei)) * ethUsdPrice,
      stockSymbol: entry.stockSymbol,
      timestamp: entry.timestamp,
      txHash: entry.txHash,
    }));
  }, [winsFeed.entries, ethUsdPrice]);

  const wins = REAL_MODE ? realWins : mockWins;

  const jackpotUsd = REAL_MODE
    ? gameStats && ethUsdPrice !== undefined
      ? Number(formatEther(gameStats.jackpotPotWei)) * ethUsdPrice
      : 0
    : mockJackpotUsd;

  const totalPaidOutLabel = REAL_MODE
    ? ethUsdPrice === undefined
      ? "…"
      : formatUsd(Number(formatEther(winsFeed.totalPaidOutWei)) * ethUsdPrice)
    : formatUsd(mockTotalPaidOutUsd);

  const cardsRemaining = REAL_MODE
    ? gameStats
      ? Number(gameStats.dailyCap - gameStats.cardsSoldToday)
      : undefined
    : GLOBAL_STATS.dailyCap - GLOBAL_STATS.cardsSoldToday;

  const dailyCapLabel = REAL_MODE
    ? gameStats
      ? gameStats.dailyCap.toLocaleString()
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
