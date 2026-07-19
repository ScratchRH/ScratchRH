import { CARD_CONFIGS, TIER_ODDS_BPS, tierPayoutUsd } from "../lib/mockData";
import { formatUsd } from "../lib/format";
import type { CardType, Tier } from "../lib/types";

interface PackWinningsTooltipProps {
  cardType: CardType;
}

const INSTANT_TIERS: Exclude<Tier, "None" | "Jackpot">[] = ["1x", "2x", "3x", "4x", "5x", "10x"];

function formatOdds(bps: number): string {
  if (bps <= 0) return "—";
  return `1 in ${Math.round(10_000 / bps).toLocaleString()}`;
}

export function PackWinningsTooltip({ cardType }: PackWinningsTooltipProps) {
  const config = CARD_CONFIGS.find((c) => c.type === cardType)!;

  return (
    <div className="pack-tooltip">
      <div className="pack-tooltip-row pack-tooltip-floor">
        <span>Floor</span>
        <span>{formatUsd(config.floorUsd, 2)} guaranteed</span>
      </div>
      {INSTANT_TIERS.map((tier) => (
        <div className="pack-tooltip-row" key={tier}>
          <span className={`tier-badge tier-${tier}`}>{tier}</span>
          <span className="pack-tooltip-odds">{formatOdds(TIER_ODDS_BPS[tier])}</span>
          <span>{formatUsd(tierPayoutUsd(tier, cardType), 2)}</span>
        </div>
      ))}
      <div className="pack-tooltip-row">
        <span className="tier-badge tier-Jackpot">Jackpot</span>
        <span className="pack-tooltip-odds">
          {config.jackpotEntries > 0 ? formatOdds(TIER_ODDS_BPS.Jackpot * config.jackpotEntries) : "Not eligible"}
        </span>
        <span>{config.jackpotEntries > 0 ? `${formatUsd(tierPayoutUsd("Jackpot", cardType), 2)}` : "—"}</span>
      </div>
    </div>
  );
}
