// Hand-authored ABI subset — only what the keeper actually calls. Not read
// from Foundry's build output (`out/`) at runtime: the keeper deploys
// standalone (e.g. Railway, with its root directory scoped to keeper/ so
// the rest of the repo — including `out/`, which is gitignored and only
// exists locally after `forge build` anyway — isn't even present in the
// container). Same "duplicated rather than shared" reasoning
// web/src/lib/scratchCoreAbi.ts already uses for the same problem.
// Exported on its own, not just found by scanning scratchCoreAbi at
// runtime, since getLogs() wants a single AbiEvent value and a runtime
// Array.find() can't be statically narrowed to that type.
export const boughtEvent = {
  type: "event",
  name: "Bought",
  inputs: [
    { name: "ticketId", type: "uint256", indexed: true },
    { name: "player", type: "address", indexed: true },
    { name: "cardType", type: "uint8", indexed: false },
  ],
} as const;

export const scratchCoreAbi = [
  boughtEvent,
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
    name: "scratch",
    stateMutability: "nonpayable",
    inputs: [{ name: "ticketId", type: "uint256" }],
    outputs: [
      { name: "tier", type: "uint8" },
      { name: "stockToken", type: "address" },
      { name: "payout", type: "uint256" },
    ],
  },
] as const;

// requestId here is always a ticketId — ScratchCore calls
// randomness.request(ticketId) using the ticket's own id as the request id.
export const randomnessAbi = [
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "targetBlock", type: "uint64" },
      { name: "fulfilled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "isRevealable",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isExpired",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
