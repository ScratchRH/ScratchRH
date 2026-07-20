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

// Separate client for dashboardCache.ts/portfolio.ts's wide-range historical
// getLogs scans — config.rpcUrl is commonly a free-tier Alchemy endpoint
// (RPC_URL was set there to dodge a Cloudflare 403 on broadcast writes,
// unrelated to reads), which hard-caps eth_getLogs at 10 blocks and would
// make DASHBOARD_SCAN_CHUNK_BLOCKS's much wider default fail every request.
// The public RPC has handled wide ranges fine everywhere else this was
// tried, so it's the default here regardless of what RPC_URL points at.
export const dashboardPublicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(config.dashboardRpcUrl),
});

export const walletClient = createWalletClient({
  account,
  chain: robinhoodChain,
  transport: http(config.rpcUrl),
});
