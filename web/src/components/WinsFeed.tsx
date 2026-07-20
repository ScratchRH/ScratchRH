import type { WinEntry } from "../lib/types";
import { explorerTxUrl, formatRelativeTime, formatUsd } from "../lib/format";
import { isChaseStock } from "../lib/mockData";

interface WinsFeedProps {
  wins: WinEntry[];
}

export function WinsFeed({ wins }: WinsFeedProps) {
  return (
    <div className="feed">
      {wins.map((win) => {
        const chase = isChaseStock(win.stockSymbol);
        const Row = win.txHash ? "a" : "div";
        return (
          <Row
            className="feed-row"
            key={win.id}
            {...(win.txHash
              ? { href: explorerTxUrl(win.txHash), target: "_blank", rel: "noopener noreferrer", title: "View payout transaction" }
              : {})}
          >
            <span className={`tier-badge tier-${win.tier}`}>{win.tier === "None" ? "Floor" : win.tier}</span>
            <span className="feed-player">
              {win.player} pulled <span className={chase ? "feed-chase-symbol" : undefined}>{win.stockSymbol}</span>
              {chase && " 🔥"}
            </span>
            <span className="feed-amount">{formatUsd(win.amountUsd, 2)}</span>
            <span className="feed-time">{formatRelativeTime(win.timestamp)}</span>
          </Row>
        );
      })}
    </div>
  );
}
