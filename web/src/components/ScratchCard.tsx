import { useEffect, useRef, useState } from "react";
import type { CardType, Tier } from "../lib/types";
import { formatUsd } from "../lib/format";
import { formatShareAmount, isChaseStock } from "../lib/mockData";

interface ScratchCardProps {
  cardType: CardType;
  tier: Tier;
  floorUsd: number;
  instantUsd: number;
  stockSymbol: string;
  resetKey: number;
  onFullyScratched?: () => void;
}

const CLEAR_THRESHOLD = 0.55;

export function ScratchCard({
  cardType,
  tier,
  floorUsd,
  instantUsd,
  stockSymbol,
  resetKey,
  onFullyScratched,
}: ScratchCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratching = useRef(false);
  const revealedRef = useRef(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    revealedRef.current = false;
    setRevealed(false);

    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;

    ctx.globalCompositeOperation = "source-over";
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#d8dee6");
    gradient.addColorStop(0.5, "#f2f5f8");
    gradient.addColorStop(1, "#c4ccd6");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    const rand = (seed: number) => {
      const x = Math.sin(seed * 999) * 10000;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 26; i++) {
      const sx = rand(i) * width;
      const sy = rand(i + 100) * height;
      const r = 1 + rand(i + 200) * 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#5c6470";
    ctx.font = "700 15px 'Chakra Petch', ui-sans-serif, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("✨ Scratch Here ✨", width / 2, height / 2);
  }, [resetKey]);

  function scratchAt(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas || revealedRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();

    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height).data;
    let cleared = 0;
    for (let i = 3; i < imageData.length; i += 4 * 8) {
      if (imageData[i] === 0) cleared++;
    }
    const total = imageData.length / (4 * 8);
    if (cleared / total > CLEAR_THRESHOLD) {
      revealedRef.current = true;
      setRevealed(true);
      onFullyScratched?.();
    }
  }

  function toCanvasCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  const chase = isChaseStock(stockSymbol);
  const totalUsd = tier === "None" ? floorUsd : instantUsd;

  return (
    <div className="scratch-canvas-wrap">
      <div
        className="scratch-result"
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(10, 12, 11, 0.35), rgba(10, 12, 11, 0.85)), url(/packs/${cardType.toLowerCase()}.webp)`,
        }}
      >
        <div className="result-pull">
          You pulled{" "}
          <span className={chase ? "result-pull-chase" : "result-pull-symbol"}>{stockSymbol}</span>
          {chase && " 🔥"}
        </div>
        <div className={`result-tier tier-${tier}`}>{tier === "None" ? "Floor Prize" : `${tier} Instant Prize!`}</div>
        <div className="result-amount">{formatUsd(totalUsd, 2)}</div>
        <div className="result-shares">≈ {formatShareAmount(totalUsd, stockSymbol)}</div>
      </div>
      {!revealed && (
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            scratching.current = true;
            const { x, y } = toCanvasCoords(e.clientX, e.clientY);
            scratchAt(x, y);
          }}
          onPointerMove={(e) => {
            if (!scratching.current) return;
            const { x, y } = toCanvasCoords(e.clientX, e.clientY);
            scratchAt(x, y);
          }}
          onPointerUp={() => {
            scratching.current = false;
          }}
          onPointerLeave={() => {
            scratching.current = false;
          }}
        />
      )}
    </div>
  );
}
