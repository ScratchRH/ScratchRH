import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  rpcUrl: required("RPC_URL"),
  chainId: Number(process.env.CHAIN_ID ?? 46630),
  keeperPrivateKey: required("KEEPER_PRIVATE_KEY") as `0x${string}`,
  scratchCoreAddress: required("SCRATCH_CORE_ADDRESS") as `0x${string}`,
  randomnessAddress: required("RANDOMNESS_ADDRESS") as `0x${string}`,
  // Optional: unset until $SCRATCH actually launches (script/LaunchScratchToken.s.sol).
  // Sweeping is skipped entirely while this is unset, so deploying this code
  // ahead of launch is a no-op rather than a crash.
  tokenTaxRouterAddress: (process.env.TOKEN_TAX_ROUTER_ADDRESS || undefined) as `0x${string}` | undefined,

  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 2000),
  stateFile: process.env.STATE_FILE ?? "./keeper-state.json",
  buyLookbackBlocks: BigInt(process.env.BUY_LOOKBACK_BLOCKS ?? "10000"),

  // Many RPC providers cap eth_getLogs to a narrow block range on free
  // tiers — Alchemy's free tier is 10. Default conservatively so the
  // keeper works out of the box there; raise it if your provider allows
  // wider ranges. logsChunkDelayMs is a small pause between chunk requests
  // so a large BUY_LOOKBACK_BLOCKS catch-up scan (1000 chunked requests at
  // the default sizes) doesn't burst past a free tier's requests-per-second
  // limit too.
  logsChunkSize: BigInt(process.env.LOGS_CHUNK_SIZE ?? "10"),
  logsChunkDelayMs: Number(process.env.LOGS_CHUNK_DELAY_MS ?? 150),

  // How often to check TokenTaxRouter's balance and sweep() it if nonzero.
  // Trading tax isn't time-sensitive the way reveals are, so this runs far
  // less often than pollIntervalMs — no reason to hammer the RPC checking a
  // balance that only moves when someone trades $SCRATCH.
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 300_000),

  x: {
    apiKey: process.env.X_API_KEY ?? "",
    apiSecret: process.env.X_API_SECRET ?? "",
    accessToken: process.env.X_ACCESS_TOKEN ?? "",
    accessSecret: process.env.X_ACCESS_SECRET ?? "",
  },
};

export function xCredentialsConfigured(): boolean {
  const { apiKey, apiSecret, accessToken, accessSecret } = config.x;
  return Boolean(apiKey && apiSecret && accessToken && accessSecret);
}
