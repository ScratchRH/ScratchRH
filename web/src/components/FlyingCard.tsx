import { useEffect, useRef } from "react";
import type { CardType } from "../lib/types";

interface FlyingCardProps {
  cardType: CardType;
  fromRect: DOMRect;
  toRect: DOMRect;
  onDone: () => void;
}

const LANDING_WIDTH = 96;
const LANDING_HEIGHT = LANDING_WIDTH * 1.4; // matches the 5:7 pack ratio
export const FLIGHT_MS = 600;

export function FlyingCard({ cardType, fromRect, toRect, onDone }: FlyingCardProps) {
  const elRef = useRef<HTMLDivElement>(null);

  // Runs once per mount — this component is always given a fresh `key` per
  // flight, so a mount-only effect (rather than depending on toRect/onDone,
  // which change identity across parent re-renders) avoids the animation
  // getting reset or its completion callback double-firing mid-flight.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const targetLeft = toRect.left + toRect.width / 2 - LANDING_WIDTH / 2;
    const targetTop = toRect.top + toRect.height / 2 - LANDING_HEIGHT / 2;

    // Paint at the source rect first, then animate to the landing spot on
    // the next frame so the browser actually transitions instead of
    // snapping straight to the end state.
    const raf = requestAnimationFrame(() => {
      el.style.left = `${targetLeft}px`;
      el.style.top = `${targetTop}px`;
      el.style.width = `${LANDING_WIDTH}px`;
      el.style.height = `${LANDING_HEIGHT}px`;
      el.style.transform = "rotate(4deg)";
    });
    // A fixed timer instead of onTransitionEnd — transitionend is flaky to
    // depend on for completion when the parent might re-render mid-flight.
    const timer = window.setTimeout(onDone, FLIGHT_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={elRef}
      className="flying-card"
      style={{
        left: fromRect.left,
        top: fromRect.top,
        width: fromRect.width,
        height: fromRect.height,
      }}
    >
      <img src={`/packs/${cardType.toLowerCase()}.webp`} alt="" />
    </div>
  );
}
