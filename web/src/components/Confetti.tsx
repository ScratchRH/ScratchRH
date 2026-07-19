import { useEffect, useMemo, useState } from "react";

interface ConfettiProps {
  /** Re-fires the burst whenever this changes. */
  burstKey: number;
}

const COLORS = ["#ffcb05", "#3d7dca", "#ee1515", "#3dae2b", "#9a5cf5", "#ff9d00"];
const PIECE_COUNT = 36;

export function Confetti({ burstKey }: ConfettiProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [burstKey]);

  const pieces = useMemo(
    () =>
      Array.from({ length: PIECE_COUNT }, (_, i) => ({
        left: Math.random() * 100,
        drift: (Math.random() - 0.5) * 160,
        delay: Math.random() * 0.35,
        duration: 1.6 + Math.random() * 0.9,
        color: COLORS[i % COLORS.length],
        spin: Math.random() > 0.5 ? 1 : -1,
        size: 7 + Math.random() * 6,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [burstKey],
  );

  if (!visible) return null;

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.6,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ["--drift" as string]: `${p.drift}px`,
            ["--spin" as string]: `${p.spin * 720}deg`,
          }}
        />
      ))}
    </div>
  );
}
