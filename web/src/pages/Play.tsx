import { useRef, useState } from "react";
import { Confetti } from "../components/Confetti";
import { FlyingCard } from "../components/FlyingCard";
import { PackCard } from "../components/PackCard";
import { ScratchCard } from "../components/ScratchCard";
import { CARD_CONFIGS, pullStock, rollTier, tierPayoutUsd } from "../lib/mockData";
import { FundSplitBar } from "../components/FundSplitBar";
import { xpForCard } from "../lib/gamification";
import { formatUsd } from "../lib/format";
import type { CardType, Tier } from "../lib/types";

interface ActiveCard {
  cardType: CardType;
  tier: Tier;
  floorUsd: number;
  instantUsd: number;
  stockSymbol: string;
  key: number;
}

interface Flight {
  cardType: CardType;
  fromRect: DOMRect;
  toRect: DOMRect;
  key: number;
}

// Mirrors the "helper bot notices the payment" delay described in How It
// Works, so the demo's pacing matches the real on-chain flow it's standing in for.
const PENDING_PAYMENT_MS = 1400;

export function Play() {
  const [selected, setSelected] = useState<CardType>("Classic");
  const [active, setActive] = useState<ActiveCard | null>(null);
  const [revealedKey, setRevealedKey] = useState<number | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [pendingCardType, setPendingCardType] = useState<CardType | null>(null);

  const pickerRefs = useRef<Partial<Record<CardType, HTMLDivElement>>>({});
  const scratchAreaRef = useRef<HTMLDivElement>(null);

  function buy() {
    const fromEl = pickerRefs.current[selected];
    const toEl = scratchAreaRef.current;
    setActive(null);
    setRevealedKey(null);
    if (fromEl && toEl) {
      setFlight({
        cardType: selected,
        fromRect: fromEl.getBoundingClientRect(),
        toRect: toEl.getBoundingClientRect(),
        key: Date.now(),
      });
    } else {
      startPending(selected);
    }
  }

  function startPending(cardType: CardType) {
    setPendingCardType(cardType);
    window.setTimeout(() => {
      const config = CARD_CONFIGS.find((c) => c.type === cardType)!;
      const tier = rollTier(config.jackpotEntries);
      setPendingCardType(null);
      setActive({
        cardType,
        tier,
        floorUsd: config.floorUsd,
        instantUsd: tierPayoutUsd(tier, config.type),
        // Jackpot always settles in SPY on-chain, regardless of the ticket's mystery pull.
        stockSymbol: tier === "Jackpot" ? "SPY" : pullStock(),
        key: Date.now(),
      });
    }, PENDING_PAYMENT_MS);
  }

  const revealed = active !== null && revealedKey === active.key;
  const wonInstant = revealed && active.tier !== "None";

  const selectedConfig = CARD_CONFIGS.find((c) => c.type === selected)!;

  return (
    <div className="stack">
      <h1 className="page-title">Pick a Pack</h1>

      <div className="panel">
        <div className="panel-title">Choose a pack</div>
        <div className="card-picker">
          {CARD_CONFIGS.map((config) => (
            <div
              key={config.type}
              ref={(el) => {
                if (el) pickerRefs.current[config.type] = el;
              }}
            >
              <PackCard
                cardType={config.type}
                priceUsd={config.priceUsd}
                selected={selected === config.type}
                onSelect={() => setSelected(config.type)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">{selectedConfig.type} Pack</div>
        <div className="pack-details">
          <div className="pack-details-stats">
            <div>
              <div className="pack-details-stat-label">Floor prize</div>
              <div className="pack-details-stat-value">{formatUsd(selectedConfig.floorUsd, 2)}</div>
            </div>
            <div>
              <div className="pack-details-stat-label">Top prize</div>
              <div className="pack-details-stat-value">10x</div>
            </div>
            <div>
              <div className="pack-details-stat-label">Jackpot entries</div>
              <div className="pack-details-stat-value">{selectedConfig.jackpotEntries || "—"}</div>
            </div>
          </div>
          <button className="btn" onClick={buy}>
            Buy {selectedConfig.type} — {formatUsd(selectedConfig.priceUsd, 2)}
          </button>
        </div>
        <div className="pack-details-split">
          <div className="pack-details-stat-label" style={{ marginBottom: 10 }}>
            Where your {formatUsd(selectedConfig.priceUsd, 2)} goes
          </div>
          <FundSplitBar priceUsd={selectedConfig.priceUsd} />
        </div>
      </div>

      <div className="panel scratch-panel">
        {wonInstant && <Confetti burstKey={active.key} />}
        <div className="panel-title">Scratch</div>
        <div className="scratch-area" ref={scratchAreaRef}>
          {pendingCardType ? (
            <div className="pending-ticket" key={pendingCardType}>
              <img className="pending-ticket-art" src={`/packs/${pendingCardType.toLowerCase()}.webp`} alt="" />
              <div className="pending-ticket-label">
                <span className="pending-spinner" />
                Pending payment…
              </div>
            </div>
          ) : active ? (
            <>
              <ScratchCard
                cardType={active.cardType}
                tier={active.tier}
                floorUsd={active.floorUsd}
                instantUsd={active.instantUsd}
                stockSymbol={active.stockSymbol}
                resetKey={active.key}
                onFullyScratched={() => setRevealedKey(active.key)}
              />
              {revealed && (
                <div className="xp-chip" key={active.key}>
                  +{xpForCard(CARD_CONFIGS.find((c) => c.type === active.cardType)!.priceUsd)} XP
                  <span className="xp-chip-sub">🔥 streak kept alive</span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">Buy a pack above to start scratching.</div>
          )}
        </div>
      </div>

      {flight && (
        <FlyingCard
          key={flight.key}
          cardType={flight.cardType}
          fromRect={flight.fromRect}
          toRect={flight.toRect}
          onDone={() => {
            setFlight(null);
            startPending(flight.cardType);
          }}
        />
      )}

      <div className="panel">
        <div className="panel-title">How buying works</div>
        <p style={{ color: "var(--fg-dim)", fontSize: 14, fontWeight: 600, lineHeight: 1.6, margin: 0 }}>
          This site never asks for a wallet connection or a signature. On mainnet, you buy a card by sending its
          price directly to the game's contract address — a helper bot notices the payment and hands you your ticket
          on-chain, no middleman ever holding your funds. The scratch above is a local demo of the odds and payout
          math while contracts are still being built.
        </p>
      </div>
    </div>
  );
}
