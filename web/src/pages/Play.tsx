import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther } from "viem";
import { Confetti } from "../components/Confetti";
import { FlyingCard } from "../components/FlyingCard";
import { PackCard } from "../components/PackCard";
import { ScratchCard } from "../components/ScratchCard";
import { CARD_CONFIGS, pullStock, rollTier, tierPayoutUsd } from "../lib/mockData";
import { FundSplitBar } from "../components/FundSplitBar";
import { xpForCard } from "../lib/gamification";
import { formatUsd } from "../lib/format";
import { getRememberedAddress, rememberAddress } from "../lib/rememberedAddress";
import { SCRATCH_CORE_ADDRESS } from "../lib/chain";
import { CARD_PRICE_WEI, cardTypeFromOnchain, isLikelyAddress, symbolForStockToken, tierFromOnchain } from "../lib/onchain";
import { useTicketWatcher } from "../hooks/useTicketWatcher";
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

// Real mode turns on the moment VITE_SCRATCH_CORE_ADDRESS is set (i.e. once
// ScratchCore is actually deployed — see script/ScratchCore.s.sol). Until
// then this stays false and the page behaves exactly as it does today: a
// local demo of the odds and payout math with no wallet, no RPC, nothing.
const REAL_MODE = Boolean(SCRATCH_CORE_ADDRESS);

export function Play() {
  const [selected, setSelected] = useState<CardType>("Classic");

  // --- demo-mode-only state ---
  const [active, setActive] = useState<ActiveCard | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [pendingCardType, setPendingCardType] = useState<CardType | null>(null);

  // --- shared: has the scratch-off canvas itself been fully scratched away ---
  const [revealedKey, setRevealedKey] = useState<number | null>(null);

  // --- real-mode-only state ---
  const [addressInput, setAddressInput] = useState(() => getRememberedAddress());
  const [watchedAddress, setWatchedAddress] = useState<`0x${string}` | undefined>(() => {
    const remembered = getRememberedAddress();
    return isLikelyAddress(remembered) ? remembered : undefined;
  });
  const [watchGeneration, setWatchGeneration] = useState(0);

  const pickerRefs = useRef<Partial<Record<CardType, HTMLDivElement>>>({});
  const scratchAreaRef = useRef<HTMLDivElement>(null);

  const ticketStatuses = useTicketWatcher(REAL_MODE ? watchedAddress : undefined, watchGeneration);
  const ticketStatus = ticketStatuses[0] ?? { phase: "idle" as const };

  const realActive: ActiveCard | null = useMemo(() => {
    if (!REAL_MODE || ticketStatus.phase !== "revealed") return null;
    const cardType = cardTypeFromOnchain(ticketStatus.cardType);
    const tier = tierFromOnchain(ticketStatus.tier);
    const config = CARD_CONFIGS.find((c) => c.type === cardType)!;
    return {
      cardType,
      tier,
      floorUsd: config.floorUsd,
      instantUsd: tierPayoutUsd(tier, cardType),
      stockSymbol: tier === "Jackpot" ? "SPY" : symbolForStockToken(ticketStatus.stockToken),
      key: Number(ticketStatus.ticketId),
    };
  }, [ticketStatus]);

  const displayActive = REAL_MODE ? realActive : active;

  // The payment lands from an external wallet, not a click on this page, so
  // nothing naturally draws the eye down to the Scratch panel the way the
  // demo mode's flying-card animation does. Jump there ourselves the moment
  // the keeper's watcher notices the payment.
  useEffect(() => {
    if (REAL_MODE && ticketStatus.phase === "pending-reveal") {
      scratchAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [ticketStatus.phase]);

  function submitAddress(value: string) {
    const trimmed = value.trim();
    if (!isLikelyAddress(trimmed)) return;
    setWatchedAddress(trimmed);
    rememberAddress(trimmed);
    setRevealedKey(null);
  }

  function watchAgain() {
    setRevealedKey(null);
    setWatchGeneration((g) => g + 1);
  }

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
        instantUsd: tierPayoutUsd(tier, cardType),
        stockSymbol: tier === "Jackpot" ? "SPY" : pullStock(),
        key: Date.now(),
      });
    }, PENDING_PAYMENT_MS);
  }

  const revealed = displayActive !== null && revealedKey === displayActive.key;
  const wonInstant = revealed && displayActive.tier !== "None";

  const selectedConfig = CARD_CONFIGS.find((c) => c.type === selected)!;

  return (
    <div className="stack">
      <h1 className="page-title">Pick a Card</h1>

      <div className="panel">
        <div className="panel-title">Choose a card</div>
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
        <div className="panel-title">{selectedConfig.type} Card</div>

        {REAL_MODE && (
          <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
            <form
              className="address-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitAddress(addressInput);
              }}
            >
              <input
                className="address-input"
                placeholder="0x... the address you'll pay from"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
              />
              <button className="btn" type="submit">
                {watchedAddress ? "Update" : "Start"}
              </button>
            </form>
            <p style={{ color: "var(--fg-dim)", fontSize: 13, fontWeight: 600, lineHeight: 1.5, margin: 0 }}>
              Typing your address is purely so this page knows what to watch for — the same as looking yourself up
              on Portfolio. It never authorizes anything and isn't required for the payment itself to work;
              attribution comes from whichever address actually sends the ETH, on-chain.
            </p>
          </div>
        )}

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

          {REAL_MODE ? (
            watchedAddress ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="holding-row">
                  <span>Send exactly</span>
                  <span>{formatEther(CARD_PRICE_WEI[selected])} ETH</span>
                </div>
                <div className="holding-row">
                  <span>To</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", textAlign: "right" }}>
                    {SCRATCH_CORE_ADDRESS}
                  </span>
                </div>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(SCRATCH_CORE_ADDRESS as string)}
                >
                  Copy contract address
                </button>
              </div>
            ) : (
              <div className="empty-state">Enter your address above to see payment instructions.</div>
            )
          ) : (
            <button className="btn" onClick={buy}>
              Buy {selectedConfig.type} — {formatUsd(selectedConfig.priceUsd, 2)}
            </button>
          )}
        </div>
        <div className="pack-details-split">
          <div className="pack-details-stat-label" style={{ marginBottom: 10 }}>
            Where your {formatUsd(selectedConfig.priceUsd, 2)} goes
          </div>
          <FundSplitBar priceUsd={selectedConfig.priceUsd} />
        </div>
      </div>

      <div className="panel scratch-panel">
        {wonInstant && <Confetti burstKey={displayActive.key} />}
        <div className="panel-title">Scratch</div>
        <div className="scratch-area" ref={scratchAreaRef}>
          {REAL_MODE ? (
            ticketStatus.phase === "pending-reveal" ? (
              <div className="pending-ticket" key={ticketStatus.ticketId.toString()}>
                <img
                  className="pending-ticket-art"
                  src={`/packs/${cardTypeFromOnchain(ticketStatus.cardType).toLowerCase()}.webp`}
                  alt=""
                />
                <div className="pending-ticket-label">
                  <span className="pending-spinner" />
                  Payment received — waiting for reveal…
                </div>
              </div>
            ) : displayActive ? (
              <>
                <ScratchCard
                  key={displayActive.key}
                  cardType={displayActive.cardType}
                  tier={displayActive.tier}
                  floorUsd={displayActive.floorUsd}
                  instantUsd={displayActive.instantUsd}
                  stockSymbol={displayActive.stockSymbol}
                  resetKey={displayActive.key}
                  onFullyScratched={() => setRevealedKey(displayActive.key)}
                />
                {revealed && (
                  <>
                    <div className="xp-chip" key={displayActive.key}>
                      +{xpForCard(CARD_CONFIGS.find((c) => c.type === displayActive.cardType)!.priceUsd)} XP
                      <span className="xp-chip-sub">🔥 streak kept alive</span>
                    </div>
                    <button className="btn btn-ghost" type="button" onClick={watchAgain}>
                      Buy another
                    </button>
                  </>
                )}
              </>
            ) : watchedAddress ? (
              <div className="empty-state">Waiting for your payment…</div>
            ) : (
              <div className="empty-state">Enter your address above, then send ETH to start scratching.</div>
            )
          ) : pendingCardType ? (
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
                key={active.key}
                cardType={active.cardType}
                tier={active.tier}
                floorUsd={active.floorUsd}
                instantUsd={active.instantUsd}
                stockSymbol={active.stockSymbol}
                resetKey={active.key}
                onFullyScratched={() => setRevealedKey(active.key)}
              />
              {revealed && (
                <>
                  <div className="xp-chip" key={active.key}>
                    +{xpForCard(CARD_CONFIGS.find((c) => c.type === active.cardType)!.priceUsd)} XP
                    <span className="xp-chip-sub">🔥 streak kept alive</span>
                  </div>
                  <button className="btn btn-ghost" type="button" onClick={buy}>
                    Buy again
                  </button>
                </>
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
          This site never asks for a wallet connection or a signature. You buy a card by sending its price directly
          to the game's contract address — a helper bot notices the payment and hands you your ticket on-chain, no
          middleman ever holding your funds. Typing in your address just tells this page which payment to watch for;
          it's not how the chain decides whose it is.{" "}
          {REAL_MODE
            ? "The scratch above is live — it only unlocks once your real payment lands on-chain."
            : "The scratch above is a local demo of the odds and payout math while contracts are still being built."}
        </p>
      </div>
    </div>
  );
}
