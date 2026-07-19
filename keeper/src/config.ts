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

  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 4000),
  stateFile: process.env.STATE_FILE ?? "./keeper-state.json",
  buyLookbackBlocks: BigInt(process.env.BUY_LOOKBACK_BLOCKS ?? "10000"),

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
