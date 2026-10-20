"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";
import { LOCAL_FORK_CHAIN_ID, LOCAL_FORK_ENABLED } from "@/lib/wagmi";

/**
 * USDC sitting idle in the user's Safe on Arbitrum One (bridged in but not yet supplied to Aave).
 * Read-only. When this is > 0 the UI offers the existing Safe -> Aave supply step. Polls so a bridge that lands after the
 * widget closes is still picked up.
 */
export function useSafeIdleUsdc(safe: Address | undefined) {
  // Same chain rule as useSafeAccount: Arbitrum One, or the local Anvil fork when the wallet is on it (development).
  const walletChainId = useChainId();
  const chainId = LOCAL_FORK_ENABLED && walletChainId === LOCAL_FORK_CHAIN_ID ? LOCAL_FORK_CHAIN_ID : ARBITRUM_CHAIN_ID;
  const client = usePublicClient({ chainId });
  const q = useQuery({
    queryKey: ["safe-idle-usdc", chainId, safe],
    enabled: !!safe && !!client,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint> =>
      client!.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "balanceOf", args: [safe!] }),
  });
  return {
    /** USDC base units (6 decimals). 0n until loaded. */
    idleUsdc: q.data ?? 0n,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}
