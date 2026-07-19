# SCRATCH — Onchain Scratch Cards on Robinhood Chain

> Context document for a Claude Code build session. Everything below is the product spec, verified chain facts, and architecture decisions already made. Working name "SCRATCH" — rename freely.

## 1. The idea in one paragraph

Scratch cards where every card wins real tokenized stock. A $5 ticket always pays a $2 floor in SPY tokens (funded from the ticket itself), has ~1-in-4 odds of an instant prize paid as a % of a self-stabilizing prize pool, and a shot at a progressive jackpot that rolls over and grows publicly for weeks. Built on Robinhood Chain because it is the only chain where stocks (SPY, NVDA, AAPL...) exist as composable ERC-20s — "you never scratch into nothing, you scratch into equity." Designed for longevity, not a one-hour pump: daily supply caps, streaks, rollover jackpots, and prize math that cannot death-spiral.

## 2. Core mechanics (decided)

### Ticket split ($5 Classic card)
| Destination | Amount | Purpose |
|---|---|---|
| Floor prize | $2.00 | Buys SPY tokens at scratch time, paid to player — every card wins this |
| Instant prize pool | $2.00 | Funds tiered instant prizes (see table) |
| Progressive jackpot | $0.50 | Accrues until hit |
| Protocol rake | $0.50 (10%) | Immutable split at deploy (HOTPOT pattern: no owner, no pause, no upgrade path) |

### Instant prize table — all prizes are % OF POOL AT SCRATCH TIME (solvent by construction)
| Tier | Odds | Prize | Pool drain/ticket |
|---|---|---|---|
| Floor | every card | $2.00 SPY (from ticket, not pool) | — |
| Common | 1 in 5 | 0.4% of instant pool | 0.080% |
| Uncommon | 1 in 20 | 1.5% of instant pool | 0.075% |
| Rare | 1 in 100 | 4% of instant pool | 0.040% |
| Epic | 1 in 500 | 10% of instant pool | 0.020% |
| Jackpot | 1 in 10,000 | 70% of progressive pot (30% rolls over to seed next) | separate stream |

Math notes:
- Instant pool self-stabilizes: inflow $2.00/ticket vs drain 0.215%/ticket → equilibrium ≈ $930. No death spiral, no runaway.
- Jackpot accrues $0.50/ticket; at 1-in-10,000 it averages ~$5,000 at hit and NEVER resets to zero (30% rollover). The climbing jackpot number is the primary marketing surface.
- Player RTP ≈ 90% (floor $2 + instant EV $2 + jackpot EV $0.50 per $5). Real-world scratch cards run 60–70% — advertise this.
- Cap any single instant payout at 40% of pool (matters for Whale cards).

### Card lineup
| Card | Price | Floor | Instant multiplier | Jackpot |
|---|---|---|---|---|
| Penny | $1 | $0.40 SPY | 0.2× | not eligible |
| Classic | $5 | $2 SPY | 1× | eligible |
| Whale | $25 | $10 SPY | 5× (respect 40% cap) | 5 entries |

### Longevity invariants (non-negotiable design goals)
1. Jackpot rollover: 70% paid on hit, 30% seeds the next round.
2. Daily mint cap (e.g. 1,000 cards/day) — whales cannot exhaust the game; sellouts create daily ritual.
3. Daily Penny card + streak counter (Duolingo mechanic). Streak milestones mint badge NFTs.
4. Player portfolio page: cumulative floor winnings shown as "you've scratched your way to $X of real stocks." Even losing players accumulate equity — this is the retention hook.
5. Seasons: weekly themed decks (AI week pays floors in NVDA, ETF week in SPY, silver week in SLV). Scratched cards persist as collectible NFTs; set completion is a second progression track.

## 3. Token ($SCRATCH) — decided: there IS a token, launched via Flap.sh

Launches through the Flap.sh portal as a `TOKEN_TAXED_V3` clone (no custom ERC20 logic possible) — see `script/LaunchScratchToken.s.sol`. $SCRATCH holders get NONE of the trading tax (decided 2026-07-19, superseding an earlier 90%-to-holders plan) — Flap's native per-holder dividend mechanism is deliberately unused (`dividendBps=0`).

- **$SCRATCH's own trading tax split: 100% routes via `mktBps` to `TokenTaxRouter.sol` (a single fixed beneficiary, not per-holder), which then splits it 10% ops / 90% straight into ScratchCore's prize pools via `ScratchCore.fundPools()` — split 50/50 between `instantPool` and `jackpotPot` there.** This taxes $SCRATCH's own buy/sell volume — separate from the ticket rake below, do not conflate the two. Trading $SCRATCH literally funds the game; it does not pay its own holders.
- Ticket rake (10% of every card sale, a completely independent fee stream) flows through `RakeRouter.sol`: 50% stays ETH to ops, 50% market-buys $SCRATCH (`RakeRouter.sweep()`, permissionless). Value accrual from game volume → token, same intent as originally planned here, now implemented as a buyback rather than feeding the jackpot directly.
- `ScratchCore.fundPools()` is a dedicated payable function, separate from `buy()`/`receive()` — bypasses ticket-purchase logic entirely so an incoming tax payment can never be mistaken for (or accidentally mint) a ticket. Permissionless; anyone can top up the prize pools, which is strictly beneficial to players.
- Tickets remain purchasable only in native ETH, no wallet-connect — token purchase is never required.
- Keep prize assets as stock tokens, never $SCRATCH — prizes must feel real.

(Superseded twice now: the original plan had $SCRATCH's tax feeding the jackpot directly via a custom 50/25/25 split, plus hold-based utility features and a USDG payment option — dropped for Flap's native dividend mechanism, simpler and already-live infrastructure. Then the 90%-to-holders dividend plan was itself dropped in favor of routing that revenue into the game's own prize pools instead, since the actual goal was never to reward passive holders — see conversation notes 2026-07-19. Tickets are also ETH-only now, not ETH/USDG — see `src/ScratchCore.sol`, which is also flat-multiplier rather than the percent-of-pool model §2 below still describes; that section is stale too and not fixed as part of this edit.)

## 4. Verified Robinhood Chain facts (fetched from official docs July 2026 — do not re-derive, but re-verify anything marked ⚠️)

- Arbitrum Orbit L2, settles to Ethereum, ETH gas token, ~100ms blocks. Mainnet live July 1 2026.
- Chain ID: **4663** (testnet 46630)
- Public RPC: `https://rpc.mainnet.chain.robinhood.com` (rate-limited; use Alchemy for prod: `https://robinhood-mainnet.g.alchemy.com/v2/{KEY}`)
- Explorer: `https://robinhoodchain.blockscout.com` (Blockscout, has API v2) · community explorer: robinscan.io
- Testnet RPC: `https://rpc.testnet.chain.robinhood.com`, explorer `explorer.testnet.chain.robinhood.com`
- Account abstraction + **gasless transaction infrastructure** available via Alchemy (docs: "Gasless Transaction Infrastructure ... gas sponsorship, batched transactions") — use for claim flows so players don't need gas.
- Standard EVM: Solidity, Hardhat/Foundry, viem/wagmi all work unmodified.

### Canonical token addresses (from docs.robinhood.com/chain/contracts — canonical list, others are fakes)
| Token | Address |
|---|---|
| USDG | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 |
| WETH | 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 |
| SPY (ETF) | 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C |
| QQQ (ETF) | 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 |
| SGOV (ETF) | 0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5 |
| SLV (ETF) | 0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f |
| AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 |
| NVDA | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC |
| TSLA | 0x322F0929c4625eD5bAd873c95208D54E1c003b2d |
| MSFT | 0xe93237C50D904957Cf27E7B1133b510C669c2e74 |
| GOOGL | 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3 |
| AMZN | 0x12f190a9F9d7D37a250758b26824B97CE941bF54 |
| META | 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35 |
| AMD | 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC |
| COIN | 0x6330D8C3178a418788dF01a47479c0ce7CCF450b |
| PLTR | 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A |

(Full list also includes BABA, BE, CRCL, CRWV, INTC, MU, ORCL, SNDK, SPCX, USAR, CUSO — see docs page.)

Infra contracts: L2 Multicall `0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

### Stock token specifics (ERC-8056 — matters for prize handling)
- Stock tokens are ERC-20, 18 decimals, but implement ERC-8056 "Scaled UI Amount": `uiMultiplier()` (1e18 fixed point) encodes corporate actions (dividends reinvested, splits). `balanceOf` is raw; `balanceOfUI` is share-equivalent.
- Chainlink price feeds exist per stock token (AggregatorV3Interface, `latestRoundData()`, typically 8 decimals). Feed price is per-token and already multiplier-adjusted.
- ⚠️ Feeds update **24/5 only** — stale on weekends. If scratch-time SPY purchase uses a DEX this doesn't matter; if using oracle for pricing, handle staleness.
- Oracles **pause during corporate actions** — check `oraclePaused()` on the token; treat as "price unavailable."
- Feed addresses: get from docs.chain.link → Robinhood network page (not hardcoded here; ⚠️ was unreachable during research).

## 5. Architecture (proposed)

### Contracts (Solidity, Foundry)
1. **ScratchCore** — ticket sales, split routing, prize pools, tier resolution, payout. Immutable, no owner functions on money paths. Daily mint cap. Emits everything (Bought, Scratched, Won, JackpotHit, RolledOver).
2. **Randomness** — ⚠️ OPEN QUESTION: Chainlink is on-chain but VRF availability on Robinhood Chain is UNVERIFIED. Check first. Fallback v1: commit-reveal vs future blockhash (acceptable at small jackpots; sequencer is Robinhood — document the trust assumption; upgrade path to VRF before jackpot > ~$5k). Do not use same-block randomness — 100ms blocks make same-block manipulation cheap.
3. **PrizeConverter** — swaps ticket proceeds → SPY/themed stock token at scratch time (Uniswap on-chain; pool addresses need discovery — Uniswap v4 per ecosystem reports, ⚠️ verify). Slippage caps. If swap fails, escrow USDG and let player claim stock later.
4. **$SCRATCH token** — taxed ERC-20, immutable tax split (jackpot/protocol/LP), launched on flap.sh or Uniswap (user has done this before with HOTPOT).
5. **CollectibleCards (ERC-721)** — scratched cards persist as NFTs with deck/season metadata; badge NFTs for streaks/sets.

### Keeper + frontend (user's established pattern from HOTPOT — respect it)
- User strongly prefers **no wallet-connect sites**: frontend is a read-only scoreboard (jackpot ticker, recent wins feed, daily supply remaining, streak leaderboards, player portfolio lookup by address). RPC reads only, no signatures.
- Purchases: direct contract interaction, or buy-by-transfer with an off-chain keeper watching transfers and calling a record function (HOTPOT's recordBuy pattern — keeper verifies against on-chain state so it can't fabricate; keeper moves zero funds).
- Scratch reveal: the scratch animation happens on the site (reading the on-chain outcome), gasless claim via Alchemy AA if a claim step exists at all — prefer auto-push payouts like HOTPOT's payout history.
- settle()/reveal() bounty pattern so any keeper can crank rounds.

### Site
- Aesthetic: user's taste is terminal/degen (see HOTPOT: dark, neon green, monospace panels, live trade tail, numbered vault-notes explaining trust assumptions). Keep the "read-only, no connect, here's exactly where every dollar goes" transparency panel — it's their signature.
- Must-have surfaces: jackpot number (huge), live wins feed, daily cards remaining, streak leaderboard, "total real stock paid out" counter, per-player portfolio page.

## 6. Competitive context (July 2026)

- **StockPackz** (stockpackz.xyz) — loot-box packs of tokenized stocks with a shared jackpot vault. Closest competitor; validated the "chance + real stock floor" mechanic. Scratch cards differentiate on: instant reveal ritual, daily cadence/streaks, rollover jackpot, collectible decks, no-connect UX.
- Ecosystem: Uniswap, 1inch, Morpho, Lighter (perps), Arcus, Rialto live; Blockscout + Robinscan explorers; RobinFlow (vesting/streams); Stockhood (premium tracker); 5 launchpads per DeFiLlama; flap.sh launchpad exists (HOTPOT launched there).
- $1M Robinhood/Arbitrum developer incentive program (Arbitrum Open House) — worth applying.

## 7. Risks & open questions

1. ⚠️ **Randomness**: verify Chainlink VRF on Robinhood Chain before writing ScratchCore. This decision shapes the contract.
2. ⚠️ **DEX liquidity for floor purchases**: verify SPY/USDG pool depth; $2 buys are trivial but check pool exists and which Uniswap version (v4 reported by third parties, v3 assumed in earlier research).
3. **Legal**: lottery/gambling-shaped product paying out securities-shaped tokens; user is aware and accepts. Frontend geo-awareness recommended. Stock tokens have jurisdiction gating history (EU-first). Not covered further here.
4. **Sequencer trust**: Robinhood runs the sequencer; blockhash randomness inherits that trust. Disclose in vault-notes panel.
5. **Trademark**: do not use Robinhood name/logo in branding ("on Robinhood Chain" descriptively is the community norm: cf. Robinscan, RobinFlow, Stockhood). No feather/animal logos.
6. **Oracle staleness/pauses**: only relevant if pricing via feeds; DEX-swap floor purchases sidestep it.

## 8. Suggested build order

1. Verify open questions (VRF, pool addresses/version, flap.sh mechanics for token launch).
2. ScratchCore + Randomness on **testnet** (chain 46630) with mock ERC-20s standing in for stock tokens.
3. PrizeConverter against real testnet/mainnet pools; end-to-end scratch on testnet.
4. Read-only site (scoreboard + scratch reveal animation) — no wallet connect.
5. Keeper (buy-watching + settle cranking).
6. $SCRATCH token launch + tax routing into jackpot.
7. Mainnet with small caps (daily cap low, Penny cards only), scale caps as jackpot/community grows.
8. Season 2: themed decks, collectible sets, streak badges.
