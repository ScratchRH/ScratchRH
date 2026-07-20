import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther } from "viem";
import { Confetti } from "../components/Confetti";
import { FlyingCard } from "../components/FlyingCard";
import { PackCard } from "../components/PackCard";
import { ScratchCard } from "../components/ScratchCard";
import { CARD_CONFIGS, pullStock, rollTier, tierPayoutUsd } from "../lib/mockData";
import { FundSplitBar } from "../components/FundSplitBar";
import { xpForCard } from "../lib/gamification";
import { formatUsd, truncateAddress } from "../lib/format";
import { getRememberedAddress, rememberAddress } from "../lib/rememberedAddress";
import { SCRATCH_CORE_ADDRESS, WHALE_SCRATCH_CORE_ADDRESS } from "../lib/chain";
import { CARD_PRICE_WEI, isLikelyAddress, symbolForStockToken, tierFromOnchain } from "../lib/onchain";
import { connectWallet, ensureRobinhoodChain, hasInjectedWallet, sendBuyBatch } from "../lib/wallet";
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

// Whale lives on a separate contract (see chain.ts's WHALE_SCRATCH_CORE_ADDRESS
// doc comment) — CardType index doesn't matter for it since all 3 of that
// contract's slots are the identical Whale config, so any value works.
const CARD_TYPE_INDEX: Record<CardType, number> = { Penny: 0, Classic: 1, Premium: 2, Whale: 0 };
const MAX_BATCH = 5;

function coreAddressFor(type: CardType): `0x${string}` | undefined {
  return type === "Whale" ? WHALE_SCRATCH_CORE_ADDRESS : SCRATCH_CORE_ADDRESS;
}

export function Play() {
  const [selected, setSelected] = useState<CardType>("Classic");
  const [count, setCount] = useState(1);

  // --- demo-mode-only state ---
  const [active, setActive] = useState<ActiveCard | null>(null);
  const [demoQueue, setDemoQueue] = useState<ActiveCard[]>([]);
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
  const [amountCopied, setAmountCopied] = useState(false);

  // --- batch (count > 1) only: needs a real wallet connection, since
  // buyBatch() needs actual calldata a plain ETH transfer can't carry.
  // Single-card buys never touch any of this.
  const [connectedWallet, setConnectedWallet] = useState<`0x${string}` | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [walletError, setWalletError] = useState<string | undefined>();

  const [currentTicketIdx, setCurrentTicketIdx] = useState(0);

  const pickerRefs = useRef<Partial<Record<CardType, HTMLDivElement>>>({});
  const scratchAreaRef = useRef<HTMLDivElement>(null);

  // Single-card buys watch whatever address the player typed in; batch buys
  // watch the connected wallet, since that's the actual on-chain sender.
  const effectiveWatchedAddress = count === 1 ? watchedAddress : connectedWallet;
  const ticketStatuses = useTicketWatcher(
    REAL_MODE ? effectiveWatchedAddress : undefined,
    watchGeneration,
    count,
    coreAddressFor(selected),
  );
  const ticketStatus = ticketStatuses[currentTicketIdx] ?? { phase: "idle" as const };

  const realActive: ActiveCard | null = useMemo(() => {
    if (!REAL_MODE || ticketStatus.phase !== "revealed") return null;
    const cardType = ticketStatus.cardType;
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
    setCurrentTicketIdx(0);
    setWatchGeneration((g) => g + 1);
  }

  async function handleConnectWallet() {
    setWalletError(undefined);
    if (!hasInjectedWallet()) {
      setWalletError("No wallet found — install Rabby, MetaMask, or similar to buy multiple cards at once.");
      return;
    }
    setConnecting(true);
    try {
      await ensureRobinhoodChain();
      const address = await connectWallet();
      setConnectedWallet(address);
    } catch (err) {
      setWalletError((err as Error).message || "Couldn't connect — try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleBuyBatch() {
    const contractAddress = coreAddressFor(selected);
    if (!connectedWallet || !contractAddress) return;
    setWalletError(undefined);
    setBuying(true);
    setRevealedKey(null);
    setCurrentTicketIdx(0);
    try {
      await ensureRobinhoodChain();
      await sendBuyBatch({
        account: connectedWallet,
        contractAddress,
        cardTypeIndex: CARD_TYPE_INDEX[selected],
        count,
        valueWei: CARD_PRICE_WEI[selected] * BigInt(count),
      });
      setWatchGeneration((g) => g + 1);
    } catch (err) {
      setWalletError((err as Error).message || "Transaction failed — try again.");
    } finally {
      setBuying(false);
    }
  }

  function buy() {
    const fromEl = pickerRefs.current[selected];
    const toEl = scratchAreaRef.current;
    setActive(null);
    setDemoQueue([]);
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
      const cards: ActiveCard[] = Array.from({ length: count }, (_, i) => {
        const tier = rollTier(config.jackpotEntries);
        return {
          cardType,
          tier,
          floorUsd: config.floorUsd,
          instantUsd: tierPayoutUsd(tier, cardType),
          stockSymbol: tier === "Jackpot" ? "SPY" : pullStock(),
          key: Date.now() + i,
        };
      });
      setPendingCardType(null);
      setActive(cards[0]);
      setDemoQueue(cards.slice(1));
    }, PENDING_PAYMENT_MS);
  }

  function nextDemoCard() {
    setActive(demoQueue[0]);
    setDemoQueue((q) => q.slice(1));
    setRevealedKey(null);
  }

  const revealed = displayActive !== null && revealedKey === displayActive.key;
  const wonInstant = revealed && displayActive.tier !== "None";

  const selectedConfig = CARD_CONFIGS.find((c) => c.type === selected)!;
  // Hide Whale in real mode until its own contract address is actually
  // configured — same "don't advertise a card nobody can pay into" guard
  // REAL_MODE itself uses for SCRATCH_CORE_ADDRESS. Demo mode always shows
  // all 4 since there's no real contract to be missing.
  const availableCardConfigs = REAL_MODE ? CARD_CONFIGS.filter((c) => c.type !== "Whale" || WHALE_SCRATCH_CORE_ADDRESS) : CARD_CONFIGS;

  return (
    <div className="stack">
      <h1 className="page-title">Pick a Card</h1>

      <div className="panel">
        <div className="panel-title">Choose a card</div>
        <div className="card-picker">
          {availableCardConfigs.map((config) => (
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
        <div className="batch-stepper">
          <span className="batch-stepper-label">Quantity</span>
          <button
            className="batch-stepper-btn"
            type="button"
            onClick={() => setCount((c) => Math.max(1, c - 1))}
            disabled={count <= 1}
          >
            −
          </button>
          <span className="batch-stepper-count">{count}</span>
          <button
            className="batch-stepper-btn"
            type="button"
            onClick={() => setCount((c) => Math.min(MAX_BATCH, c + 1))}
            disabled={count >= MAX_BATCH}
          >
            +
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">{selectedConfig.type} Card</div>

        {REAL_MODE && count === 1 && (
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

        {REAL_MODE && count > 1 && connectedWallet && (
          <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
            <div className="holding-row">
              <span>Connected wallet</span>
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>{truncateAddress(connectedWallet)}</span>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => setConnectedWallet(undefined)}>
              Disconnect
            </button>
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
            count === 1 ? (
              watchedAddress ? (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="holding-row">
                    <span>Send exactly</span>
                    <button
                      type="button"
                      className="copy-value"
                      onClick={() => {
                        navigator.clipboard?.writeText(formatEther(CARD_PRICE_WEI[selected]));
                        setAmountCopied(true);
                        window.setTimeout(() => setAmountCopied(false), 1500);
                      }}
                    >
                      {amountCopied ? "Copied!" : `${formatEther(CARD_PRICE_WEI[selected])} ETH`}
                    </button>
                  </div>
                  <div className="holding-row">
                    <span>To</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", textAlign: "right" }}>
                      {coreAddressFor(selected)}
                    </span>
                  </div>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(coreAddressFor(selected) as string)}
                  >
                    Copy contract address
                  </button>
                </div>
              ) : (
                <div className="empty-state">Enter your address above to see payment instructions.</div>
              )
            ) : connectedWallet ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="holding-row">
                  <span>Total for {count}</span>
                  <span>{formatEther(CARD_PRICE_WEI[selected] * BigInt(count))} ETH</span>
                </div>
                <button className="btn" type="button" onClick={handleBuyBatch} disabled={buying}>
                  {buying ? "Confirm in wallet…" : `Buy ${count} × ${selectedConfig.type}`}
                </button>
                {walletError && <div className="empty-state">{walletError}</div>}
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <button className="btn" type="button" onClick={handleConnectWallet} disabled={connecting}>
                  {connecting ? "Connecting…" : "Connect wallet to buy multiple"}
                </button>
                {walletError && <div className="empty-state">{walletError}</div>}
              </div>
            )
          ) : (
            <button className="btn" onClick={buy}>
              {count > 1
                ? `Buy ${count} × ${selectedConfig.type} — ${formatUsd(selectedConfig.priceUsd * count, 2)}`
                : `Buy ${selectedConfig.type} — ${formatUsd(selectedConfig.priceUsd, 2)}`}
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
                  src={`/packs/${ticketStatus.cardType.toLowerCase()}.webp`}
                  alt=""
                />
                <div className="pending-ticket-label">
                  <span className="pending-spinner" />
                  Payment received — waiting for reveal…
                </div>
                <p style={{ color: "var(--fg-dim)", fontSize: 13, fontWeight: 600, margin: 0, textAlign: "center" }}>
                  Usually 10-30 seconds — the reveal waits on a future block for fairness, so nobody (including us)
                  can know the outcome ahead of time.
                </p>
              </div>
            ) : displayActive ? (
              <>
                {count > 1 && (
                  <div className="batch-progress">
                    Card {currentTicketIdx + 1} of {count}
                  </div>
                )}
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
                    {currentTicketIdx < count - 1 && ticketStatuses[currentTicketIdx + 1]?.phase === "revealed" ? (
                      <button className="btn" type="button" onClick={() => { setCurrentTicketIdx((i) => i + 1); setRevealedKey(null); }}>
                        Next card ({count - currentTicketIdx - 1} remaining)
                      </button>
                    ) : currentTicketIdx < count - 1 ? (
                      <div className="empty-state">Waiting for next card reveal…</div>
                    ) : (
                      <button className="btn btn-ghost" type="button" onClick={watchAgain}>
                        Buy another
                      </button>
                    )}
                  </>
                )}
              </>
            ) : effectiveWatchedAddress ? (
              <div className="empty-state">Waiting for your payment…</div>
            ) : (
              <div className="empty-state">
                {count > 1 ? "Connect your wallet above, then buy to start scratching." : "Enter your address above, then send ETH to start scratching."}
              </div>
            )
          ) : pendingCardType ? (
            <div className="pending-ticket" key={pendingCardType}>
              <img className="pending-ticket-art" src={`/packs/${pendingCardType.toLowerCase()}.webp`} alt="" />
              <div className="pending-ticket-label">
                <span className="pending-spinner" />
                {count > 1 ? `Pending ${count} cards…` : "Pending payment…"}
              </div>
            </div>
          ) : active ? (
            <>
              {(demoQueue.length > 0 || count > 1) && (
                <div className="batch-progress">
                  Card {count - demoQueue.length} of {count}
                </div>
              )}
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
                  {demoQueue.length > 0 ? (
                    <button className="btn" type="button" onClick={nextDemoCard}>
                      Next card ({demoQueue.length} remaining)
                    </button>
                  ) : (
                    <button className="btn btn-ghost" type="button" onClick={buy}>
                      Buy again
                    </button>
                  )}
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
          Buying one card never needs a wallet connection or a signature — send its price directly to the game's
          contract address and a helper bot notices the payment and hands you your ticket on-chain, no middleman
          ever holding your funds. Typing in your address just tells this page which payment to watch for; it's not
          how the chain decides whose it is. Buying more than one at once needs your wallet connected instead, since
          that's a real contract call (<code className="docs-code">buyBatch</code>) rather than a plain transfer —
          your wallet builds and signs it, same as any other on-chain app.{" "}
          {REAL_MODE
            ? "The scratch above is live — it only unlocks once your real payment lands on-chain."
            : "The scratch above is a local demo of the odds and payout math while contracts are still being built."}
        </p>
      </div>
    </div>
  );
}
