import { FUND_SPLIT } from "../lib/mockData";

interface FundSplitBarProps {
  priceUsd?: number;
}

export function FundSplitBar({ priceUsd }: FundSplitBarProps) {
  return (
    <div className="fund-split">
      <div className="fund-split-bar">
        {FUND_SPLIT.map((segment) => (
          <div
            key={segment.label}
            className="fund-split-bar-segment"
            style={{ width: `${segment.bps / 100}%`, background: segment.colorVar }}
            title={`${segment.label} — ${segment.bps / 100}%`}
          />
        ))}
      </div>
      <div className="fund-split-legend">
        {FUND_SPLIT.map((segment) => (
          <div className="fund-split-legend-item" key={segment.label}>
            <span className="fund-split-legend-swatch" style={{ background: segment.colorVar }} />
            <div>
              <div className="fund-split-legend-label">
                {segment.label} · {segment.bps / 100}%
                {priceUsd !== undefined && ` · $${((priceUsd * segment.bps) / 10_000).toFixed(2)}`}
              </div>
              <div className="fund-split-legend-note">{segment.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
