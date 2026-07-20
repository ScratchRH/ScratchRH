import { createWalletClient, custom } from "viem";
import { robinhoodChain } from "./chain";

// Only used for batch purchases (buyBatch) — single-card buys stay
// wallet-free by design (see Docs.tsx / Play.tsx's "How buying works"),
// since batch needs real calldata (cardType + count) that a plain ETH
// transfer can't carry. No wagmi/connectkit dependency: viem already wraps
// an injected EIP-1193 provider directly via the `custom` transport.
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const buyBatchAbi = [
  {
    type: "function",
    name: "buyBatch",
    stateMutability: "payable",
    inputs: [
      { name: "cardType", type: "uint8" },
      { name: "count", type: "uint8" },
    ],
    outputs: [{ name: "ticketIds", type: "uint256[]" }],
  },
] as const;

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

function walletClient() {
  if (!window.ethereum) throw new Error("No wallet found — install Rabby, MetaMask, or similar.");
  return createWalletClient({ chain: robinhoodChain, transport: custom(window.ethereum) });
}

export async function connectWallet(): Promise<`0x${string}`> {
  const [address] = await walletClient().requestAddresses();
  return address;
}

/// Switches the wallet to Robinhood Chain, adding it first if the wallet
/// doesn't know about it yet (error code 4902 is the EIP-3085 signal for
/// that). Best-effort — swallows the error if the wallet doesn't support
/// programmatic chain switching, since the tx itself will just fail
/// clearly if the wallet ends up on the wrong chain anyway.
export async function ensureRobinhoodChain(): Promise<void> {
  const client = walletClient();
  try {
    const currentChainId = await client.getChainId();
    if (currentChainId === robinhoodChain.id) return;
    await client.switchChain({ id: robinhoodChain.id });
  } catch (err) {
    const code = (err as { code?: number } | undefined)?.code;
    if (code !== 4902 || !window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${robinhoodChain.id.toString(16)}`,
            chainName: robinhoodChain.name,
            nativeCurrency: robinhoodChain.nativeCurrency,
            rpcUrls: robinhoodChain.rpcUrls.default.http,
            blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
          },
        ],
      });
    } catch {
      // best-effort — a wallet that can't add the chain will just fail the tx clearly instead
    }
  }
}

export async function sendBuyBatch(params: {
  account: `0x${string}`;
  contractAddress: `0x${string}`;
  cardTypeIndex: number;
  count: number;
  valueWei: bigint;
}): Promise<`0x${string}`> {
  return walletClient().writeContract({
    account: params.account,
    address: params.contractAddress,
    abi: buyBatchAbi,
    functionName: "buyBatch",
    args: [params.cardTypeIndex, params.count],
    value: params.valueWei,
  });
}
