import { CARD_CONFIGS, MYSTERY_DECK, TIER_ODDS_BPS, tierPayoutUsd } from "../lib/mockData";
import { formatUsd } from "../lib/format";
import type { Tier } from "../lib/types";

const INSTANT_TIERS: Exclude<Tier, "None" | "Jackpot">[] = ["1x", "2x", "3x", "4x", "5x", "10x"];

function formatOdds(bps: number): string {
  if (bps <= 0) return "—";
  return `1 in ${Math.round(10_000 / bps).toLocaleString()}`;
}

export function Odds() {
  return (
    <div className="stack">
      <h1 className="page-title">Possible Winnings</h1>

      <div className="panel">
        <div className="panel-title">How prizes work</div>
        <p className="flywheel-intro">
          Every card pays exactly one of: the guaranteed floor prize, a flat multiplier of the card's own price (1x
          up to 10x), or the jackpot — paid from the jackpot pot and always settled in SPY. The stock a floor or
          multiplier prize pays out in is pulled from the mystery deck below at the same moment your tier is decided
          — nobody knows what a card pays until it's scratched.
        </p>
      </div>

      {CARD_CONFIGS.map((config) => (
        <div className="panel" key={config.type}>
          <div className="panel-title">
            <span className="odds-card-heading">
              <video
                className="odds-mini-card"
                src={`/packs/${config.type.toLowerCase()}.mp4`}
                autoPlay
                loop
                muted
                playsInline
              />
              {config.type} — {formatUsd(config.priceUsd, 2)}
            </span>
            <span>Floor: {formatUsd(config.floorUsd, 2)} guaranteed</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Odds</th>
                <th>Est. Payout</th>
              </tr>
            </thead>
            <tbody>
              {INSTANT_TIERS.map((tier) => (
                <tr key={tier}>
                  <td>
                    <span className={`tier-badge tier-${tier}`}>{tier}</span>
                  </td>
                  <td>{formatOdds(TIER_ODDS_BPS[tier])}</td>
                  <td>{formatUsd(tierPayoutUsd(tier, config.type), 2)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <span className="tier-badge tier-Jackpot">Jackpot</span>
                </td>
                <td>
                  {config.jackpotEntries > 0 ? formatOdds(TIER_ODDS_BPS.Jackpot * config.jackpotEntries) : "Not eligible"}
                </td>
                <td>
                  {config.jackpotEntries > 0
                    ? `${formatUsd(tierPayoutUsd("Jackpot", config.type), 2)} · always SPY`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div className="panel">
        <div className="panel-title">Mystery stock deck</div>
        <p className="flywheel-intro">
          Floor and instant prizes — everything except the jackpot — pay out in whichever stock gets pulled from
          this deck. Same odds on every card, regardless of tier.
        </p>
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th>Pull Odds</th>
            </tr>
          </thead>
          <tbody>
            {MYSTERY_DECK.map((entry) => (
              <tr key={entry.symbol}>
                <td>
                  <span className={entry.chase ? "feed-chase-symbol" : undefined}>{entry.symbol}</span>
                  {entry.chase && " 🔥"}
                </td>
                <td>{(entry.weightBps / 100).toLocaleString()}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
