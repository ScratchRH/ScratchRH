# SCRATCH

Onchain scratch cards on Robinhood Chain — every card wins real tokenized
stock. Full product spec, chain facts, and architecture decisions: [SPEC.md](./SPEC.md).

## Contracts

Foundry project rooted at repo root.

- `src/ScratchCore.sol` — ticket sales, split routing, prize pools, tier
  resolution, payout. Immutable, no owner functions on money paths.
- `src/Randomness.sol` — future-blockhash randomness (Chainlink VRF
  availability on Robinhood Chain is unconfirmed; see SPEC.md §7.1).
- `src/interfaces/` — `IStockToken` (ERC-8056 scaled UI amount), `IPriceFeed`
  (Chainlink AggregatorV3Interface subset), `IPrizeConverter` (DEX swap,
  implementation deferred pending SPY/USDG pool discovery — SPEC.md §7.2).

### Build & test

```shell
forge build
forge test
```

### Status

Testnet-only skeleton with mock ERC-20s standing in for stock tokens
(SPEC.md §8 build order step 2). `PrizeConverter`'s real Uniswap v4
integration, the `$SCRATCH` token, and `CollectibleCards` are not yet built.
