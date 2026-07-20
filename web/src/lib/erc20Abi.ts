// Minimal ERC20 subset — just what's needed to track $SCRATCH burns
// (useBurnStats.ts). Flap's TOKEN_TAXED_V3 tokens are otherwise-standard
// ERC20s (see script/LaunchScratchToken.s.sol's header comment), so this
// isn't $SCRATCH-specific.
export const erc20Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
