import { useEffect, useState } from "react";
import { JackpotTicker } from "../components/JackpotTicker";
import { StatTile } from "../components/StatTile";
import { WinsFeed } from "../components/WinsFeed";
import { GLOBAL_STATS, generateMockWins, pullStock, rollTier } from "../lib/mockData";
import { formatCountdown, msUntilNextUtcMidnight } from "../lib/gamification";
import { formatUsd } from "../lib/format";
import type { WinEntry } from "../lib/types";

function useRestockCountdown(): string {
  const [remaining, setRemaining] = useState(() => msUntilNextUtcMidnight());

  useEffect(() => {
    const interval = setInterval(() => setRemaining(msUntilNextUtcMidnight()), 1000);
    return () => clearInterval(interval);
  }, []);

  return formatCountdown(remaining);
}

export function Home() {
  const [wins, setWins] = useState<WinEntry[]>(() => generateMockWins(18));
  const [jackpotUsd, setJackpotUsd] = useState(GLOBAL_STATS.jackpotPotUsd);
  const [totalPaidOutUsd, setTotalPaidOutUsd] = useState(GLOBAL_STATS.totalStockPaidOutUsd);
  const countdown = useRestockCountdown();

  useEffect(() => {
    const interval = setInterval(() => {
      setWins((prev) => {
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
        setTotalPaidOutUsd((prevTotal) => prevTotal + amountUsd);
        return [next, ...prev].slice(0, 40);
      });
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // The jackpot is real S&P 500 exposure that grows from rake even when
  // nobody's actively playing — tick it up independent of the wins feed.
  useEffect(() => {
    const interval = setInterval(() => {
      setJackpotUsd((prev) => prev + 0.5 + Math.random() * 2.5);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const cardsRemaining = GLOBAL_STATS.dailyCap - GLOBAL_STATS.cardsSoldToday;

  return (
    <div className="stack">
      <h1 className="page-title">Scoreboard</h1>

      <JackpotTicker valueUsd={jackpotUsd} />

      <div className="grid grid-stats">
        <StatTile
          label="Total Stock Paid Out"
          value={formatUsd(totalPaidOutUsd)}
          sub="Cumulative floor + instant + jackpot"
          accent
        />
        <StatTile
          label="Cards Remaining Today"
          value={cardsRemaining.toLocaleString()}
          sub={`of ${GLOBAL_STATS.dailyCap.toLocaleString()} daily cap`}
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
