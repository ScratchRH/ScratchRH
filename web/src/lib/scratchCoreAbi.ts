// Hand-authored subset of ScratchCore's ABI — only the reads and events the
// web client actually needs (ticket status polling). Not generated from the
// Foundry build artifact: the web app is a separate deploy from the
// contracts, same "duplicated rather than shared" call keeper/src/chain.ts
// makes for chain facts.
export const scratchCoreAbi = [
  {
    type: "event",
    name: "Bought",
    inputs: [
      { name: "ticketId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "cardType", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Scratched",
    inputs: [
      { name: "ticketId", type: "uint256", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "stockToken", type: "address", indexed: false },
      { name: "payout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Won",
    inputs: [
      { name: "ticketId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "payout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "buyBatch",
    stateMutability: "payable",
    inputs: [
      { name: "cardType", type: "uint8" },
      { name: "count", type: "uint8" },
    ],
    outputs: [{ name: "ticketIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "tickets",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "player", type: "address" },
      { name: "cardType", type: "uint8" },
      { name: "stockToken", type: "address" },
      { name: "scratched", type: "bool" },
    ],
  },
] as const;
