import type { Config } from "wagmi";
import { switchChain } from "wagmi/actions";
import { ARBITRUM_CHAIN_ID } from "./contracts/arbitrum";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_EXPLORER, ROBINHOOD_RPC } from "./contracts/robinhood";

export interface Eip3085ChainParams {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}

/** Canonical EIP-3085 parameters for automatically registering and switching chains in user wallets. */
export const CHAIN_ADD_PARAMS: Record<number, Eip3085ChainParams> = {
  [ROBINHOOD_CHAIN_ID]: {
    chainId: "0x1237",
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [ROBINHOOD_RPC],
    blockExplorerUrls: [ROBINHOOD_EXPLORER],
  },
  [ARBITRUM_CHAIN_ID]: {
    chainId: "0xa4b1",
    chainName: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://arbiscan.io"],
  },
  8453: {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
  10: {
    chainId: "0xa",
    chainName: "OP Mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.optimism.io"],
    blockExplorerUrls: ["https://optimistic.etherscan.io"],
  },
  137: {
    chainId: "0x89",
    chainName: "Polygon",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorerUrls: ["https://polygonscan.com"],
  },
};

/**
 * Automatically switches the wallet to targetChainId.
 * If the wallet returns error 4902 (Unrecognized chain ID / chain not added),
 * automatically issues `wallet_addEthereumChain` with RPC and explorer metadata,
 * then switches to the newly added chain seamlessly.
 */
export async function switchOrAddChain(config: Config, targetChainId: number): Promise<boolean> {
  const currentChainId = config.state.chainId;
  if (currentChainId === targetChainId) return true;

  try {
    await switchChain(config, { chainId: targetChainId });
    return true;
  } catch (err: unknown) {
    // If standard switch failed, attempt direct wallet_addEthereumChain via window.ethereum
    if (typeof window !== "undefined" && (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum) {
      const eth = (window as unknown as { ethereum: { request: (args: unknown) => Promise<unknown> } }).ethereum;
      const params = CHAIN_ADD_PARAMS[targetChainId];
      if (params) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [params],
          });
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: params.chainId }],
          });
          return true;
        } catch {
          // Re-throw original error if add/switch also failed
        }
      }
    }
    throw err;
  }
}
