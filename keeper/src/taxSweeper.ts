import { config } from "./config.js";
import { publicClient, walletClient } from "./chain.js";
import { tokenTaxRouterAbi } from "./abi.js";

/// Checks TokenTaxRouter's balance and sweeps it into ScratchCore's prize
/// pools (+ ops wallet) if there's anything to move. No-ops entirely while
/// TOKEN_TAX_ROUTER_ADDRESS is unset (pre-launch). sweep() is permissionless
/// and reverts with NothingToSweep() on a zero balance, so a plain balance
/// check up front avoids paying gas to find that out the hard way.
export async function maybeSweep(lastSweepCheckAt: number): Promise<number> {
  if (!config.tokenTaxRouterAddress) return lastSweepCheckAt;
  if (Date.now() - lastSweepCheckAt < config.sweepIntervalMs) return lastSweepCheckAt;

  const routerAddress = config.tokenTaxRouterAddress;
  try {
    const balance = await publicClient.getBalance({ address: routerAddress });
    if (balance > 0n) {
      const { request } = await publicClient.simulateContract({
        account: walletClient.account,
        address: routerAddress,
        abi: tokenTaxRouterAbi,
        functionName: "sweep",
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[tax-sweeper] swept ${balance} wei from TokenTaxRouter (tx ${hash})`);
    }
  } catch (err) {
    console.error(`[tax-sweeper] sweep check failed: ${(err as Error).message.split("\n")[0]}`);
  }

  return Date.now();
}
