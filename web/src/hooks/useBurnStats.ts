import { useEffect, useRef, useState } from "react";
import { publicClient, SCRATCH_TOKEN_ADDRESS, SCRATCH_TOKEN_DEPLOY_BLOCK } from "../lib/chain";
import { erc20Abi } from "../lib/erc20Abi";

const POLL_INTERVAL_MS = 30_000; // burns aren't time-sensitive, unlike ticket reveals
const SCAN_CHUNK_BLOCKS = 2_000n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
// Flap's tax-token deflation mechanism isn't independently documented (no
// getter/event found for "buyback executed" specifically when checked
// against a live Flap tax token 2026-07-20) — only that it's confirmed to
// shrink total supply. Rather than guess a single burn-sink address, watch
// both addresses actually used in practice by ERC20 "burns": the true zero
// address, and the conventional 0x...dEaD sink some tokens send to instead.
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

const transferEvent = erc20Abi.find((e) => e.type === "event" && e.name === "Transfer")!;

export interface BurnStats {
  totalBurnedRaw: bigint;
  decimals: number;
}

/// Scans $SCRATCH's own Transfer events for transfers to a burn-sink
/// address since launch, to reconstruct a cumulative burned total — nothing
/// on-chain tracks this as a single counter. Returns undefined until
/// VITE_SCRATCH_TOKEN_ADDRESS / VITE_SCRATCH_TOKEN_DEPLOY_BLOCK are set
/// (i.e. always, until $SCRATCH actually launches) or before the first scan
/// completes.
export function useBurnStats(): BurnStats | undefined {
  const [stats, setStats] = useState<BurnStats | undefined>(undefined);
  const lastScannedBlockRef = useRef<bigint | null>(null);

  useEffect(() => {
    if (!SCRATCH_TOKEN_ADDRESS || SCRATCH_TOKEN_DEPLOY_BLOCK === undefined) return;
    const tokenAddress = SCRATCH_TOKEN_ADDRESS;
    const deployBlock = SCRATCH_TOKEN_DEPLOY_BLOCK;
    let cancelled = false;

    async function scan() {
      if (cancelled) return;

      const decimals = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" });

      const latest = await publicClient.getBlockNumber();
      let chunkStart = lastScannedBlockRef.current !== null ? lastScannedBlockRef.current + 1n : deployBlock;
      if (chunkStart > latest) return;

      while (chunkStart <= latest && !cancelled) {
        const chunkEnd = chunkStart + SCAN_CHUNK_BLOCKS - 1n < latest ? chunkStart + SCAN_CHUNK_BLOCKS - 1n : latest;

        let burnLogs;
        try {
          burnLogs = await publicClient.getLogs({
            address: tokenAddress,
            event: transferEvent,
            args: { to: [ZERO_ADDRESS, DEAD_ADDRESS] },
            fromBlock: chunkStart,
            toBlock: chunkEnd,
          });
        } catch (err) {
          console.error(`[useBurnStats] getLogs ${chunkStart}-${chunkEnd} failed, resuming next poll:`, err);
          break;
        }

        if (burnLogs.length > 0) {
          const addedRaw = burnLogs.reduce((sum, log) => sum + (log.args.value as bigint), 0n);
          if (!cancelled) {
            setStats((prev) => ({ totalBurnedRaw: (prev?.totalBurnedRaw ?? 0n) + addedRaw, decimals }));
          }
        } else if (!cancelled) {
          setStats((prev) => prev ?? { totalBurnedRaw: 0n, decimals });
        }

        lastScannedBlockRef.current = chunkEnd;
        chunkStart = chunkEnd + 1n;
      }
    }

    scan();
    const interval = window.setInterval(scan, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return stats;
}
