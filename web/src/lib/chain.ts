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

// $SCRATCH itself — unset until script/LaunchScratchToken.s.sol actually
// runs, unlike SCRATCH_CORE_DEPLOY_BLOCK above there's no way to know this
// ahead of time, so both come from env rather than one being hardcoded.
// Fill both in once the token exists; Flywheel's burn stat stays hidden
// until then.
export const SCRATCH_TOKEN_ADDRESS = import.meta.env.VITE_SCRATCH_TOKEN_ADDRESS as `0x${string}` | undefined;
const rawTokenDeployBlock = import.meta.env.VITE_SCRATCH_TOKEN_DEPLOY_BLOCK as string | undefined;
export const SCRATCH_TOKEN_DEPLOY_BLOCK = rawTokenDeployBlock ? BigInt(rawTokenDeployBlock) : undefined;

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
