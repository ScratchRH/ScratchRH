import { useEffect, useState } from "react";
import { SAMPLE_PORTFOLIOS } from "../lib/mockData";
import { getRememberedAddress, rememberAddress } from "../lib/rememberedAddress";
import { formatRelativeTime, formatUsd } from "../lib/format";
import { StatTile } from "../components/StatTile";
import { WinsFeed } from "../components/WinsFeed";

const SAMPLE_ADDRESS = "0xcafe...beef";

export function Portfolio() {
  const [input, setInput] = useState("");
  const [lookedUp, setLookedUp] = useState<string | null>(null);

  useEffect(() => {
    const address = getRememberedAddress();
    if (address) {
      setInput(address);
      setLookedUp(address);
    }
  }, []);

  const portfolio = lookedUp ? SAMPLE_PORTFOLIOS[lookedUp.toLowerCase().trim()] : undefined;

  function lookUp(address: string) {
    setLookedUp(address);
    if (SAMPLE_PORTFOLIOS[address.toLowerCase().trim()]) {
      rememberAddress(address);
    }
  }

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
            placeholder={`0x... (try ${SAMPLE_ADDRESS})`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn" type="submit">
            Look up
          </button>
        </form>

        {lookedUp && !portfolio && (
          <div className="empty-state">No ticket history found for that address on this demo dataset.</div>
        )}

        {portfolio && (
          <div className="stack">
            <div className="grid grid-stats">
              <StatTile
                label="Floor Winnings"
                value={formatUsd(portfolio.totalFloorWonUsd)}
                sub="you've scratched your way to real stock"
                accent
              />
              <StatTile label="Instant Winnings" value={formatUsd(portfolio.totalInstantWonUsd)} />
              <StatTile label="Current Streak" value={`${portfolio.streak} days`} />
              <StatTile label="Cards Scratched" value={portfolio.cardsScratched.toLocaleString()} />
            </div>

            <div className="panel">
              <div className="panel-title">Holdings (by floor + instant prizes)</div>
              {portfolio.holdings.map((holding) => (
                <div className="holding-row" key={holding.symbol}>
                  <span>{holding.symbol}</span>
                  <span>{formatUsd(holding.amountUsd)}</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panel-title">
                <span>Scratch History</span>
                <span>{formatRelativeTime(portfolio.history[0]?.timestamp ?? Date.now())} to now</span>
              </div>
              <WinsFeed wins={portfolio.history} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
