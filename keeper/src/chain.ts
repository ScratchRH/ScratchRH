import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

// Same chain facts as web/src/lib/chain.ts (SPEC.md §4). Duplicated rather
// than shared as a package since the keeper and web app deploy separately.
export const robinhoodChain = defineChain({
  id: config.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [config.rpcUrl] },
  },
});

export const account = privateKeyToAccount(config.keeperPrivateKey);

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(config.rpcUrl),
});

export const walletClient = createWalletClient({
  account,
  chain: robinhoodChain,
  transport: http(config.rpcUrl),
});
