# SCRATCH — Onchain Scratch Cards on Robinhood Chain

Every card pays real tokenized stock. A $5 Classic card guarantees a $2 floor prize in SPY (or another stock from the season's deck), has ~1-in-4 odds of an instant multiplier prize, and a shot at a progressive jackpot that grows even when nobody's playing. Built on Robinhood Chain — the only chain where stocks like SPY, AAPL, and NVDA exist as composable ERC-20s.

**Live at [scratchrh.xyz](https://scratchrh.xyz)**

---

## How it works

1. Send the exact ETH price to the contract address — no wallet connection required
2. A keeper bot spots your payment and reveals your card on-chain within a few blocks
3. Scratch to see your prize tier and which stock you pulled
4. Stock lands in your wallet immediately via a live Uniswap v4 swap

Every outcome is determined by a future blockhash sealed at buy time. Nobody — including the team — can see or influence the result ahead of time.

## Prize structure

Every card's ETH price splits four ways at purchase:

| Slice | Share | What it does |
|---|---|---|
| Floor prize | 40% | Guaranteed stock payout on every card |
| Instant pool | 40% | Funds 1×–10× multiplier prizes |
| Jackpot | 10% | Progressive pot, always denominated in SPY |
| Ops | 10% | Keeps the game running |

Jackpot pays 70% to the winner, 30% rolls over. It always settles in SPY regardless of which stock your card pulled.

## Card types

| Type | Price | Floor prize | Jackpot entries |
|---|---|---|---|
| Penny | 0.001 ETH | ~$0.40 | None |
| Classic | 0.005 ETH | ~$2.00 | 1 |
| Premium | 0.01 ETH | ~$4.00 | 2 |

---

## Architecture

```
.
├── src/                             # Solidity contracts
│   ├── ScratchCore.sol              # Buy, scratch, prize resolution, pool accounting
│   ├── Randomness.sol               # Future-blockhash commit-reveal
│   ├── UniswapV4PrizeConverter.sol  # ETH → stock token via Uniswap v4
│   ├── TokenTaxRouter.sol           # Routes $SCRATCH trading tax → prize pools
│   ├── RakeRouter.sol               # Routes card-sale rake → $SCRATCH buyback
│   └── interfaces/                  # IPrizeConverter, IScratchConverter, IStockToken, etc.
├── script/                          # Foundry deploy scripts
│   ├── ScratchCore.s.sol            # Deploys converter → randomness → core → taxRouter
│   └── LaunchScratchToken.s.sol     # Launches $SCRATCH via Flap (TOKEN_TAXED_V3)
├── test/                            # 96 passing tests
├── keeper/                          # Node.js keeper service (deploys to Railway)
│   └── src/
│       ├── revealWatcher.ts         # Polls for pending tickets, calls scratch()
│       └── tweetWatcher.ts          # Posts jackpot/big-win tweets
└── web/                             # React/Vite frontend (deploys to Vercel)
    └── src/
        ├── pages/                   # Play, Portfolio, Odds, Leaderboard, Docs, Flywheel
        ├── components/              # ScratchCard, PackCard, FundSplitBar, NavBar
        ├── hooks/                   # useTicketWatcher — polls Bought/Scratched events
        └── lib/                     # chain.ts, onchain.ts, mockData.ts
```

## Tech stack

- **Contracts** — Solidity 0.8.x, Foundry, Uniswap v4, Robinhood Chain (chain ID 4663)
- **Keeper** — Node.js, TypeScript, viem, Railway
- **Frontend** — React 19, Vite, viem, Vercel

---

## Local development

### Contracts

```bash
# Install Foundry: https://getfoundry.sh
forge install
forge build
forge test          # 96 tests, all passing
```

### Frontend

```bash
cd web
npm install
npm run dev
```

The frontend runs in **demo mode** by default — no chain interaction, no wallet required, odds and payout math simulated locally. Set `VITE_SCRATCH_CORE_ADDRESS` in `web/.env.local` to point it at a real deployed contract and switch to live mode.

### Keeper

```bash
cd keeper
cp .env.example .env   # fill in RPC_URL, contract addresses, keeper key
npm install
npm run dev
```

---

## Deploying contracts

`ScratchCore.s.sol` handles the full deploy sequence in the right order:

```bash
forge script script/ScratchCore.s.sol \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --broadcast \
  --private-key $DEPLOYER_KEY
```

Deploys: `UniswapV4PrizeConverter` → `Randomness` → `ScratchCore` → `TokenTaxRouter`.

After deployment, call `setPoolConfig()` on the converter with the real Uniswap v4 pool parameters (fee, tickSpacing, hooks) for each stock token — `scratch()` reverts with `PoolNotConfigured` until this is done.

Then launch $SCRATCH (after filling in the real `TOKEN_TAX_ROUTER` address in the script):

```bash
META_CID=<ipfs-cid> forge script script/LaunchScratchToken.s.sol \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --broadcast \
  --private-key $DEPLOYER_KEY
```

---

## $SCRATCH token

Flap-native TOKEN_TAXED_V3 with a 3% buy/sell tax routed three ways:

- **80%** → ScratchCore prize pools (50/50 instant / jackpot) via `TokenTaxRouter`
- **10%** → Ops
- **10%** → Automatic buyback-and-burn via Flap's native `deflationBps`

No holder dividends. Card-sale rake separately buys $SCRATCH via `RakeRouter` on every card sold, creating independent buy pressure.

---

## Contract security

All contracts are immutable — no admin can change odds, pause payouts, or sweep pools while the game is active. The only owner controls are:

- `ScratchCore.setDailyCap()` — adjusts cards-per-day supply cap, cannot touch prices or odds
- `ScratchCore.withdraw()` — only unlocks after 36 consecutive hours with zero purchases (dead-game recovery valve, not a live rug lever)

Randomness uses future-blockhash via `Randomness.sol`. Planned upgrade to Chainlink VRF before the jackpot exceeds ~$5k.

---

## License

MIT
