import { createPublicClient, defineChain, http } from "viem";

// Same chain facts as keeper/src/chain.ts, duplicated rather than shared as
// a package since the keeper and web app deploy separately. Defaults to
// Robinhood Chain mainnet since this is the public-facing site; override via
// .env.local for local/testnet development against an anvil fork or the
// real testnet (chain 46630).
const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 4663);

// Unset until ScratchCore is actually deployed (see script/ScratchCore.s.sol).
// Pages that need real chain data should treat an unset address as "demo
// mode" rather than trying to point at nothing.
export const SCRATCH_CORE_ADDRESS = import.meta.env.VITE_SCRATCH_CORE_ADDRESS as `0x${string}` | undefined;

// Block ScratchCore was created at — start of the range event-scanning
// (Scoreboard's paid-out total, live wins feed) needs to cover. Update this
// alongside VITE_SCRATCH_CORE_ADDRESS whenever ScratchCore gets redeployed;
// a stale value just means re-scanning a few thousand already-empty blocks,
// not a correctness bug, but keeping it close keeps that scan fast.
export const SCRATCH_CORE_DEPLOY_BLOCK = 14_794_301n;

// Second, parallel ScratchCore for the $30 Whale card (script/ScratchCore.s.sol's
// runVip(), reuses the main game's already-configured PrizeConverter — not a
// redeploy of the main $1/$5/$10 game). Unset hides the Whale card from Play
// entirely rather than showing a card nobody can actually pay into.
export const WHALE_SCRATCH_CORE_ADDRESS = import.meta.env.VITE_WHALE_SCRATCH_CORE_ADDRESS as `0x${string}` | undefined;

// $SCRATCH itself — unset until script/LaunchScratchToken.s.sol actually
// runs, unlike SCRATCH_CORE_DEPLOY_BLOCK above there's no way to know this
// ahead of time, so both come from env rather than one being hardcoded.
// Fill both in once the token exists; Flywheel's burn stat stays hidden
// until then.
export const SCRATCH_TOKEN_ADDRESS = import.meta.env.VITE_SCRATCH_TOKEN_ADDRESS as `0x${string}` | undefined;
const rawTokenDeployBlock = import.meta.env.VITE_SCRATCH_TOKEN_DEPLOY_BLOCK as string | undefined;
export const SCRATCH_TOKEN_DEPLOY_BLOCK = rawTokenDeployBlock ? BigInt(rawTokenDeployBlock) : undefined;

// The keeper's dashboard-cache HTTP API (keeper/src/server.ts) — it scans
// chain history continuously server-side and serves the result as JSON, so
// the Scoreboard and Leaderboard pages fetch instantly instead of every
// visitor's browser re-scanning event history itself. Unset means those
// pages fall back to demo mode, same as an unset SCRATCH_CORE_ADDRESS.
export const KEEPER_API_URL = (import.meta.env.VITE_KEEPER_API_URL as string | undefined)?.replace(/\/$/, "");

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
});

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL),
});
