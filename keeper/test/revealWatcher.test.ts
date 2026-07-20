import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  getContractAddress,
  parseEventLogs,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const OUT_DIR = path.join(REPO_ROOT, "out");
const RPC_PORT = 8551;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const STATE_FILE = path.join(__dirname, ".keeper-state.test.json");

function loadArtifact(contractFile: string, contractName: string) {
  const json = JSON.parse(readFileSync(path.join(OUT_DIR, contractFile, `${contractName}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object as Hex };
}

/// Spawns anvil and resolves once it has printed its default account private
/// keys to stdout (also confirms the node is actually up before tests hit it).
function startAnvil(): Promise<{ proc: ChildProcessWithoutNullStreams; privateKeys: Hex[] }> {
  return new Promise((resolve, reject) => {
    const anvilBin = path.join(process.env.HOME ?? "", ".foundry/bin/anvil");
    const proc = spawn(anvilBin, ["--port", String(RPC_PORT)], { stdio: "pipe" });

    let output = "";
    const timeout = setTimeout(() => reject(new Error("anvil did not start in time")), 15_000);

    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const keyLines = [...output.matchAll(/\(\d+\)\s+(0x[0-9a-fA-F]{64})/g)];
      if (keyLines.length >= 3) {
        clearTimeout(timeout);
        resolve({ proc, privateKeys: keyLines.map((m) => m[1] as Hex) });
      }
    });
    proc.on("error", reject);
    proc.stderr.on("data", (chunk) => console.error("[anvil]", chunk.toString()));
  });
}

test("reveal watcher cranks a matured ticket end-to-end on a local anvil chain", async (t) => {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);

  const { proc: anvil, privateKeys } = await startAnvil();
  t.after(() => {
    anvil.kill();
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  });

  const deployer = privateKeyToAccount(privateKeys[0]);
  const keeperPrivateKey = privateKeys[1];
  const player = privateKeyToAccount(privateKeys[2]);

  const chain = {
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  } as const;

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const deployerClient = createWalletClient({ account: deployer, chain, transport: http(RPC_URL) });
  const playerClient = createWalletClient({ account: player, chain, transport: http(RPC_URL) });

  async function deploy(contractFile: string, contractName: string, args: unknown[] = []) {
    const { abi, bytecode } = loadArtifact(contractFile, contractName);
    const hash = await deployerClient.deployContract({ abi, bytecode, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`${contractName} deploy failed`);
    return { address: receipt.contractAddress, abi };
  }

  // ScratchCore is paid in native ETH (no ERC20 payment token) — anvil's
  // default accounts start funded, so no minting/approval step is needed.
  const spy = await deploy("MockStockToken.sol", "MockStockToken", ["Mock SPY", "mSPY"]);
  const converter = await deploy("MockPrizeConverter.sol", "MockPrizeConverter");

  // Randomness needs to know ScratchCore's address up front (immutable
  // `consumer`), so predict it from the deployer's next nonce — same trick
  // used in test/ScratchCore.t.sol.
  const nonce = await publicClient.getTransactionCount({ address: deployer.address });
  const predictedCore = getContractAddress({ from: deployer.address, nonce: BigInt(nonce) + 1n });

  const randomness = await deploy("Randomness.sol", "Randomness", [predictedCore]);

  const dailyCap = 1000n;
  const deck = [{ token: spy.address, weightBps: 10_000 }];
  // Same lineup ScratchCore.s.sol's _cardConfigs() ships — Penny/Classic/Premium.
  const cardConfigs = [
    { price: parseEther("0.001"), jackpotEntries: 0 },
    { price: parseEther("0.005"), jackpotEntries: 1 },
    { price: parseEther("0.01"), jackpotEntries: 2 },
  ];
  const core = await deploy("ScratchCore.sol", "ScratchCore", [
    converter.address,
    randomness.address,
    deployer.address, // rakeRecipient
    spy.address, // jackpotStockToken
    deck,
    cardConfigs,
    dailyCap,
    deployer.address, // owner
  ]);
  assert.equal(core.address.toLowerCase(), predictedCore.toLowerCase(), "CREATE address prediction must match");

  // Buy a Classic ticket by sending its exact ETH price directly.
  const CARD_TYPE_CLASSIC = 1;
  const buyHash = await playerClient.writeContract({
    address: core.address,
    abi: core.abi,
    functionName: "buy",
    args: [CARD_TYPE_CLASSIC],
    value: parseEther("0.005"),
  });
  const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
  const [boughtEvent] = parseEventLogs({ abi: core.abi, logs: buyReceipt.logs, eventName: "Bought" }) as unknown as [
    { args: { ticketId: bigint } },
  ];
  const ticketId = boughtEvent.args.ticketId;

  // Point the keeper's env at this deployment, then load its modules only
  // now — config.ts reads env vars at import time.
  process.env.RPC_URL = RPC_URL;
  process.env.CHAIN_ID = "31337";
  process.env.KEEPER_PRIVATE_KEY = keeperPrivateKey;
  process.env.SCRATCH_CORE_ADDRESS = core.address;
  process.env.RANDOMNESS_ADDRESS = randomness.address;
  process.env.STATE_FILE = STATE_FILE;

  const { initState, runOnce } = await import("../src/revealWatcher.js");

  const testCore = {
    label: "main",
    scratchCoreAddress: core.address as `0x${string}`,
    randomnessAddress: randomness.address as `0x${string}`,
    stateFile: STATE_FILE,
  };

  let state = await initState(testCore);
  state = await runOnce(testCore, state);
  assert.ok(state.pendingTicketIds.includes(ticketId.toString()), "ticket should be queued but not yet revealable");

  // REVEAL_DELAY is 3 blocks; mine well past that instantly instead of
  // waiting on wall-clock time.
  await publicClient.request({ method: "anvil_mine" as never, params: ["0x5"] as never });

  state = await runOnce(testCore, state);
  assert.ok(
    !state.pendingTicketIds.includes(ticketId.toString()),
    "ticket should have been scratched and removed from the pending queue",
  );

  const spyBalance = await publicClient.readContract({
    address: spy.address,
    abi: spy.abi,
    functionName: "balanceOf",
    args: [player.address],
  });

  assert.ok((spyBalance as bigint) > 0n, "player should have received at least the floor payout in SPY");
});
