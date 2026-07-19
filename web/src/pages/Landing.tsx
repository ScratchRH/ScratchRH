import { Link } from "react-router-dom";
import { CARD_CONFIGS } from "../lib/mockData";
import { formatUsd } from "../lib/format";

const FEATURES = [
  {
    title: "No wallet connect to buy",
    body: "Buy a card by sending its price on-chain — no approvals, no signature beyond proving you own an address if you choose to verify it.",
  },
  {
    title: "Every card pays real stock",
    body: "A floor prize is guaranteed on every card, paid in real tokenized shares — no exceptions.",
  },
  {
    title: "Jackpot grows even when nobody's playing",
    body: "The jackpot is real S&P 500 exposure that compounds on its own — 70% paid on hit, 30% rolls over.",
  },
  {
    title: "Fully on-chain, provably fair",
    body: "Every tier and stock pull comes from the same future-blockhash randomness — verify any ticket yourself.",
  },
];

export function Landing() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <h1 className="landing-title">Every card pays real stock.</h1>
        <p className="landing-sub">
          Onchain scratch cards on Robinhood Chain. Buy a pack, scratch it, and walk away holding real tokenized
          shares — floor prize guaranteed, jackpot always growing.
        </p>
        <div className="landing-cta-row">
          <Link className="btn" to="/play">
            Play Now
          </Link>
          <Link className="btn btn-ghost" to="/odds">
            See the Odds
          </Link>
        </div>
      </section>

      <section className="landing-tiers">
        {CARD_CONFIGS.map((config) => (
          <Link key={config.type} to="/play" className="landing-tier-card">
            <video
              className="landing-tier-video"
              src={`/packs/${config.type.toLowerCase()}.mp4`}
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="landing-tier-name">{config.type}</div>
            <div className="landing-tier-price">{formatUsd(config.priceUsd, 2)}</div>
          </Link>
        ))}
      </section>

      <section className="landing-features">
        {FEATURES.map((f) => (
          <div className="landing-feature" key={f.title}>
            <div className="landing-feature-title">{f.title}</div>
            <p className="landing-feature-body">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="landing-final-cta">
        <Link className="btn" to="/play">
          Pick a Pack
        </Link>
      </section>
    </div>
  );
}
