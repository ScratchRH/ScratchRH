import { FundSplitBar } from "../components/FundSplitBar";

interface FlywheelNode {
  id: string;
  label: string;
  category: "core" | "token" | "engagement";
  x: number;
  y: number;
  blurb: string;
}

// Hexagon layout, clockwise from the top. Coordinates match the viewBox
// below so the SVG connectors and the HTML node divs line up.
const NODES: FlywheelNode[] = [
  {
    id: "daily",
    label: "Free daily scratch",
    category: "engagement",
    x: 350,
    y: 80,
    blurb: "One free floor-value card per day — claimed with your SIWE session, no transaction ever.",
  },
  {
    id: "streak",
    label: "Streak compounds",
    category: "engagement",
    x: 580,
    y: 220,
    blurb: "Every consecutive day boosts floor payouts up to +50%. Breaking the streak costs you.",
  },
  {
    id: "buy",
    label: "Buy cards",
    category: "core",
    x: 580,
    y: 420,
    blurb: "Streak bonuses make paid packs better value — and a slice of every sale buys $SCRATCH and feeds the jackpot.",
  },
  {
    id: "push",
    label: "House pushes stock",
    category: "core",
    x: 350,
    y: 560,
    blurb: "Every payout is sent by the operator wallet, which pays the gas. No claims, no approvals, no signatures.",
  },
  {
    id: "grow",
    label: "Portfolio & deck grow",
    category: "token",
    x: 120,
    y: 420,
    blurb: "Your wallet fills with real stock and rare pulls fill the collection book — all read straight off the chain.",
  },
  {
    id: "shared",
    label: "Wins get shared",
    category: "engagement",
    x: 120,
    y: 220,
    blurb: "Big wins and completed decks auto-post to X — new players verify once and enter the loop.",
  },
];

const LOOP_PATH =
  "M350,80 Q520,120 580,220 Q640,320 580,420 Q520,520 350,560 Q180,520 120,420 Q60,320 120,220 Q180,120 350,80 Z";

const ARROW_SEGMENTS = [
  "M350,80 Q520,120 580,220",
  "M580,220 Q640,320 580,420",
  "M580,420 Q520,520 350,560",
  "M350,560 Q180,520 120,420",
  "M120,420 Q60,320 120,220",
  "M120,220 Q180,120 350,80",
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
          grows your portfolio. The free daily scratch brings you back, the streak makes leaving expensive, rare pulls
          give the collection book meaning, and the growing stack gives you news to check even on days you don't buy.
        </p>

        <div className="flywheel-diagram">
          <svg className="flywheel-svg" viewBox="0 0 700 640" role="img" aria-label="Flywheel diagram">
            <title>SCRATCH flywheel: free daily scratch, streak compounds, buy cards, house pushes stock, portfolio and deck grow, wins get shared, back to the free daily scratch</title>
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
        <div className="panel-title">Zero signatures by design</div>
        <p className="flywheel-intro">
          The whole loop runs on one signature — the plain SIWE message that proves an address is yours. Everything
          else is either read from the chain or pushed to you.
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
            <div className="flywheel-pattern-icon">✍️</div>
            <div className="flywheel-pattern-title">One signature, ever</div>
            <p>
              The free daily scratch is the only thing the chain can't witness, so it's gated by your SIWE session — a
              signed text message that moves nothing and can't approve anything.
            </p>
          </div>
        </div>
        <p className="flywheel-fineprint">
          Free scratches unlock only for addresses that have bought at least one card — the chain itself is the
          anti-abuse system. No CAPTCHAs, no email signups.
        </p>
      </div>
    </div>
  );
}
