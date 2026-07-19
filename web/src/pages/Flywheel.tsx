import { FundSplitBar } from "../components/FundSplitBar";
import { TOKEN_TAX_SPLIT } from "../lib/mockData";

interface FlywheelNode {
  id: string;
  label: string;
  category: "core" | "token" | "engagement";
  x: number;
  y: number;
  blurb: string;
}

// Pentagon layout, clockwise from the top. Coordinates match the viewBox
// below so the SVG connectors and the HTML node divs line up.
const NODES: FlywheelNode[] = [
  {
    id: "streak",
    label: "Streak compounds",
    category: "engagement",
    x: 350,
    y: 80,
    blurb: "Buy at least one card a day and the streak compounds — floor payouts scale up to +50%. Skip a day and it resets.",
  },
  {
    id: "buy",
    label: "Buy cards",
    category: "core",
    x: 570,
    y: 246,
    blurb: "Streak bonuses make paid packs better value — and a slice of every sale buys $SCRATCH and feeds the jackpot.",
  },
  {
    id: "push",
    label: "House pushes stock",
    category: "core",
    x: 485,
    y: 514,
    blurb: "Every payout is sent by the operator wallet, which pays the gas. No claims, no approvals, no signatures.",
  },
  {
    id: "grow",
    label: "Portfolio & deck grow",
    category: "token",
    x: 215,
    y: 514,
    blurb: "Your wallet fills with real stock and rare pulls fill the collection book — all read straight off the chain.",
  },
  {
    id: "shared",
    label: "Wins get shared",
    category: "engagement",
    x: 131,
    y: 246,
    blurb: "Big wins and completed decks auto-post to X — new players enter the loop straight from the buy.",
  },
];

const LOOP_PATH =
  "M350,80 Q500,108 570,246 Q590,401 485,514 Q350,582 215,514 Q111,401 131,246 Q202,108 350,80 Z";

const ARROW_SEGMENTS = [
  "M350,80 Q500,108 570,246",
  "M570,246 Q590,401 485,514",
  "M485,514 Q350,582 215,514",
  "M215,514 Q111,401 131,246",
  "M131,246 Q202,108 350,80",
];

const LOOP_DURATION_S = 8;

export function Flywheel() {
  return (
    <div className="stack">
      <h1 className="page-title">The Flywheel</h1>

      <div className="panel">
        <div className="panel-title">How the loop reinforces itself</div>
        <p className="flywheel-intro">
          Unlike a casino, nobody leaves empty-handed — every card pays floor value in real stock, so even a "loss"
          grows your portfolio. The streak makes buying again worth it, rare pulls give the collection book meaning,
          and the growing stack gives you news to check even on days you don't buy.
        </p>

        <div className="flywheel-diagram">
          <svg className="flywheel-svg" viewBox="0 0 700 640" role="img" aria-label="Flywheel diagram">
            <title>SCRATCH flywheel: streak compounds, buy cards, house pushes stock, portfolio and deck grow, wins get shared, back to streak compounds</title>
            <defs>
              <marker id="flywheel-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="rgba(214, 221, 216, 0.55)" />
              </marker>
            </defs>

            {ARROW_SEGMENTS.map((d, i) => (
              <path key={i} d={d} className="flywheel-arrow" markerEnd="url(#flywheel-arrow)" />
            ))}

            <circle r="7" className="flywheel-pulse">
              <animateMotion dur={`${LOOP_DURATION_S}s`} repeatCount="indefinite" path={LOOP_PATH} rotate="auto" />
            </circle>
          </svg>

          {NODES.map((node, i) => (
            <div
              key={node.id}
              className={`flywheel-node flywheel-node-${node.category}`}
              style={{
                left: `${(node.x / 700) * 100}%`,
                top: `${(node.y / 640) * 100}%`,
                animationDelay: `${(i / NODES.length) * LOOP_DURATION_S}s`,
              }}
              title={node.blurb}
            >
              {node.label}
            </div>
          ))}
        </div>

        <div className="flywheel-legend">
          <span className="flywheel-legend-item">
            <span className="flywheel-legend-swatch flywheel-node-core" /> Core loop
          </span>
          <span className="flywheel-legend-item">
            <span className="flywheel-legend-swatch flywheel-node-token" /> Token economy
          </span>
          <span className="flywheel-legend-item">
            <span className="flywheel-legend-swatch flywheel-node-engagement" /> Engagement loop
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Where every dollar goes</div>
        <p className="flywheel-intro">
          The split that funds the whole loop is locked into the contract before launch — nobody, including us, can
          change it once it's live.
        </p>
        <FundSplitBar />
      </div>

      <div className="panel">
        <div className="panel-title">Where every $SCRATCH trade goes</div>
        <p className="flywheel-intro">
          A separate split from the one above — this taxes $SCRATCH's own trading, not card sales. $SCRATCH holders
          get none of it as dividends: trading the token funds the game's prize pools directly and shrinks the
          token's own supply, instead of paying passive holders.
        </p>
        <FundSplitBar segments={TOKEN_TAX_SPLIT} />
      </div>

      <div className="panel">
        <div className="panel-title">Zero signatures by design</div>
        <p className="flywheel-intro">
          Nothing here ever asks you to sign a message, connect a wallet, or approve anything. Every step runs off
          public purchase and payout events, read straight from the chain or pushed to you.
        </p>
        <div className="flywheel-patterns">
          <div className="flywheel-pattern">
            <div className="flywheel-pattern-icon">📖</div>
            <div className="flywheel-pattern-title">The chain is the database</div>
            <p>
              Streaks, collections, portfolios, and leaderboards are all derived from public purchase and payout
              events. No accounts, no login — anyone can look up any address.
            </p>
          </div>
          <div className="flywheel-pattern">
            <div className="flywheel-pattern-icon">📬</div>
            <div className="flywheel-pattern-title">The house signs, you don't</div>
            <p>
              Every payout — floors, instant prizes, streak bonuses, set-completion rewards — is push-based from the
              operator wallet, which also pays the gas. Stock just shows up.
            </p>
          </div>
          <div className="flywheel-pattern">
            <div className="flywheel-pattern-icon">🔎</div>
            <div className="flywheel-pattern-title">You tell the site, not the chain</div>
            <p>
              Typing in your address just tells this page what to watch for — the same as looking yourself up on
              Portfolio. Attribution itself comes from whichever address actually sends the ETH, not from anything
              you type.
            </p>
          </div>
        </div>
        <p className="flywheel-fineprint">
          There are no accounts to create and nothing to sign up for — any address can look itself up, any address
          can buy. No CAPTCHAs, no email signups.
        </p>
      </div>
    </div>
  );
}
