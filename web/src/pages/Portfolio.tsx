import { useState } from "react";
import { formatEther } from "viem";
import { SAMPLE_PORTFOLIOS } from "../lib/mockData";
import { getRememberedAddress, rememberAddress } from "../lib/rememberedAddress";
import { formatRelativeTime, formatUsd } from "../lib/format";
import { StatTile } from "../components/StatTile";
import { WinsFeed } from "../components/WinsFeed";
import { KEEPER_API_URL } from "../lib/chain";
import { isLikelyAddress, symbolForStockToken } from "../lib/onchain";
import { useScoreboardApi } from "../hooks/useScoreboardApi";
import { usePortfolioApi } from "../hooks/usePortfolioApi";
import type { WinEntry } from "../lib/types";

const SAMPLE_ADDRESS = "0xcafe...beef";
const REAL_MODE = Boolean(KEEPER_API_URL);

export function Portfolio() {
  const [input, setInput] = useState(() => getRememberedAddress());
  const [lookedUp, setLookedUp] = useState<string | null>(() => {
    const remembered = getRememberedAddress();
    return remembered || null;
  });

  const scoreboard = useScoreboardApi(); // only used here for ethUsdPrice
  const realLookupAddress = REAL_MODE && lookedUp && isLikelyAddress(lookedUp) ? (lookedUp as `0x${string}`) : undefined;
  const realPortfolio = usePortfolioApi(realLookupAddress);

  const mockPortfolio = !REAL_MODE && lookedUp ? SAMPLE_PORTFOLIOS[lookedUp.toLowerCase().trim()] : undefined;

  function lookUp(address: string) {
    setLookedUp(address);
    if (REAL_MODE ? isLikelyAddress(address) : SAMPLE_PORTFOLIOS[address.toLowerCase().trim()]) {
      rememberAddress(address);
    }
  }

  const ethUsdPrice = scoreboard?.ethUsdPrice;

  const realHistory: WinEntry[] | undefined =
    realPortfolio.phase === "ready" && ethUsdPrice !== undefined
      ? realPortfolio.data.history.map((entry) => ({
          id: entry.id,
          player: lookedUp ?? "",
          cardType: "Penny", // unused by WinsFeed's rendering
          tier: entry.tier,
          amountUsd: Number(formatEther(entry.amountWei)) * ethUsdPrice,
          stockSymbol: symbolForStockToken(entry.stockToken),
          timestamp: entry.timestamp,
          txHash: entry.txHash,
        }))
      : undefined;

  const notFound = REAL_MODE
    ? realLookupAddress !== undefined && realPortfolio.phase === "ready" && realPortfolio.data.cardsScratched === 0
    : Boolean(lookedUp) && !mockPortfolio;

  const invalidAddress = REAL_MODE && lookedUp !== null && !isLikelyAddress(lookedUp);
  const stillLoading = REAL_MODE && realLookupAddress !== undefined && (realPortfolio.phase === "loading" || realPortfolio.phase === "idle");
  const lookupFailed = REAL_MODE && realPortfolio.phase === "error";

  return (
    <div className="stack">
      <h1 className="page-title">Portfolio</h1>

      <div className="panel">
        <div className="panel-title">
          <span>Look up a player</span>
        </div>
        <form
          className="address-form"
          onSubmit={(e) => {
            e.preventDefault();
            lookUp(input);
          }}
        >
          <input
            className="address-input"
            placeholder={REAL_MODE ? "0x... any address that's bought a card" : `0x... (try ${SAMPLE_ADDRESS})`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn" type="submit">
            Look up
          </button>
        </form>

        {invalidAddress && <div className="empty-state">That doesn't look like a valid address.</div>}
        {stillLoading && <div className="empty-state">Loading…</div>}
        {lookupFailed && <div className="empty-state">Couldn't reach the API — try again in a moment.</div>}
        {notFound && <div className="empty-state">No ticket history found for that address.</div>}

        {REAL_MODE && realPortfolio.phase === "ready" && realPortfolio.data.cardsScratched > 0 && ethUsdPrice !== undefined && (
          <div className="stack">
            <div className="grid grid-stats">
              <StatTile
                label="Floor Winnings"
                value={formatUsd(Number(formatEther(realPortfolio.data.totalFloorWonWei)) * ethUsdPrice)}
                sub="you've scratched your way to real stock"
                accent
              />
              <StatTile
                label="Instant Winnings"
                value={formatUsd(Number(formatEther(realPortfolio.data.totalInstantWonWei)) * ethUsdPrice)}
              />
              <StatTile label="Cards Scratched" value={realPortfolio.data.cardsScratched.toLocaleString()} />
            </div>

            <div className="panel">
              <div className="panel-title">Holdings (by floor + instant prizes)</div>
              {realPortfolio.data.holdings.map((holding) => (
                <div className="holding-row" key={holding.stockToken}>
                  <span>{symbolForStockToken(holding.stockToken)}</span>
                  <span>{formatUsd(Number(formatEther(holding.amountWei)) * ethUsdPrice)}</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panel-title">
                <span>Scratch History</span>
                <span>{formatRelativeTime(realPortfolio.data.history[0]?.timestamp ?? Date.now())} to now</span>
              </div>
              <WinsFeed wins={realHistory ?? []} />
            </div>
          </div>
        )}

        {!REAL_MODE && mockPortfolio && (
          <div className="stack">
            <div className="grid grid-stats">
              <StatTile
                label="Floor Winnings"
                value={formatUsd(mockPortfolio.totalFloorWonUsd)}
                sub="you've scratched your way to real stock"
                accent
              />
              <StatTile label="Instant Winnings" value={formatUsd(mockPortfolio.totalInstantWonUsd)} />
              <StatTile label="Cards Scratched" value={mockPortfolio.cardsScratched.toLocaleString()} />
            </div>

            <div className="panel">
              <div className="panel-title">Holdings (by floor + instant prizes)</div>
              {mockPortfolio.holdings.map((holding) => (
                <div className="holding-row" key={holding.symbol}>
                  <span>{holding.symbol}</span>
                  <span>{formatUsd(holding.amountUsd)}</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panel-title">
                <span>Scratch History</span>
                <span>{formatRelativeTime(mockPortfolio.history[0]?.timestamp ?? Date.now())} to now</span>
              </div>
              <WinsFeed wins={mockPortfolio.history} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
