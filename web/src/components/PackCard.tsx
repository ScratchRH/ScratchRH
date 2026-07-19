import { useRef, useState } from "react";
import type { CardType } from "../lib/types";
import { formatUsd } from "../lib/format";
import { PackWinningsTooltip } from "./PackWinningsTooltip";

interface PackCardProps {
  cardType: CardType;
  priceUsd: number;
  selected: boolean;
  onSelect: () => void;
}

const PACK_META: Record<CardType, { icon: string; ribbon: string }> = {
  Penny: { icon: "⭐", ribbon: "Starter" },
  Classic: { icon: "🎴", ribbon: "Most Popular" },
  Premium: { icon: "👑", ribbon: "High Roller" },
};

export function PackCard({ cardType, priceUsd, selected, onSelect }: PackCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const meta = PACK_META[cardType];
  const hasArt = !videoFailed;

  function handleMouseMove(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
  }

  function resetGlare() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "50%");
  }

  return (
    <div className="pack-wrap" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        ref={ref}
        type="button"
        data-card={cardType}
        className={`pack${selected ? " selected" : ""}${hasArt ? " has-art" : ""}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={resetGlare}
        onClick={onSelect}
        aria-pressed={selected}
      >
        {hasArt && (
          <video
            className="pack-art"
            poster={`/packs/${cardType.toLowerCase()}.webp`}
            src={`/packs/${cardType.toLowerCase()}.mp4`}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setVideoFailed(true)}
          />
        )}
        <span className="pack-ribbon">{meta.ribbon}</span>
        <span className="pack-glare" />
        {hasArt && <span className="pack-scrim" />}
        {!hasArt && <span className="pack-icon">{meta.icon}</span>}
        <span className="pack-name">{cardType}</span>
        <span className="pack-price">{formatUsd(priceUsd, 2)}</span>
      </button>
      {hovered && <PackWinningsTooltip cardType={cardType} />}
    </div>
  );
}
