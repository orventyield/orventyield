"use client";

import { useChainId } from "wagmi";
import { resolveEngine } from "@/lib/yieldEngine";
import { useMorphoAccount } from "./useMorphoAccount";
import { useSafeAccount } from "./useSafeAccount";

/**
 * Network-aware routing: chain 42161 -> Aave v3 (useSafeAccount), chain 4663 -> Morpho VaultV2 (useMorphoAccount).
 * `selectedChainId` is the chain chosen in the app (the Phase 3 network switcher); without one the wallet's own chain decides,
 * and any other network (e.g. Base while bridging) keeps the default, Arbitrum One. Only the selected engine reads from the
 * network; the other is paused.
 */
export function useYieldAccount(selectedChainId?: number) {
  const walletChainId = useChainId();
  const { engine, chainId } = resolveEngine(selectedChainId ?? walletChainId);
  const aave = useSafeAccount({ active: engine === "aave" });
  const morpho = useMorphoAccount({ active: engine === "morpho" });
  return { engine, chainId, aave, morpho };
}
