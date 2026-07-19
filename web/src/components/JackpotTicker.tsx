import { useEffect, useRef, useState } from "react";
import { formatUsd } from "../lib/format";

interface JackpotTickerProps {
  valueUsd: number;
}

export function JackpotTicker({ valueUsd }: JackpotTickerProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const frame = useRef<number>(0);
  // Tracks where the last animation landed, so a live-updating jackpot eases
  // from its current value to the new one instead of resetting to $0 and
  // counting back up on every tick.
  const fromValue = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const duration = 900;
    const from = fromValue.current;
    const to = valueUsd;

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        fromValue.current = to;
      }
    }

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [valueUsd]);

  return (
    <div className="jackpot-panel">
      <div className="jackpot-label">Progressive Jackpot</div>
      <div className="jackpot-value">{formatUsd(displayValue)}</div>
      <div className="jackpot-sub">70% paid on hit &middot; 30% rolls over &middot; never resets to zero</div>
    </div>
  );
}
