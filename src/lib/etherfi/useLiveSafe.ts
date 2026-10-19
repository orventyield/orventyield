"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { verifiedAddress } from "../contracts/etherfi";
import { cashLensAbi, debtManagerAbi, etherFiSafeAbi, safeFactoryAbi } from "./abi";
import { parseSafeCashData, type LiveSafe, type RawSafeCashData } from "./snapshot";

const CHAIN = 10;
export const LIVE_REFRESH_MS = 20_000;

export type LiveStatus = "idle" | "loading" | "ready" | "not-safe" | "error";

export interface UseLiveSafe {
  status: LiveStatus;
  live: LiveSafe | null;
  owners: Address[];
  /** Connected wallet is one of the Safe's owners. */
  isOwner: boolean;
  updatedAt: number | null;
  refetch: () => void;
}

/** Reads a real Ether.fi Safe on Optimism: balances, debt, limits and health, refreshed every 20 s. */
export function useLiveSafe(safe: Address | null): UseLiveSafe {
  const { address: wallet } = useAccount();
  const factory = verifiedAddress(CHAIN, "EtherFiSafeFactory");
  const lens = verifiedAddress(CHAIN, "CashLens");
  const dm = verifiedAddress(CHAIN, "DebtManager");
  const enabled = !!safe && !!factory && !!lens && !!dm;

  const q = useReadContracts({
    contracts:
      safe && factory && lens && dm
        ? ([
            { chainId: CHAIN, address: factory, abi: safeFactoryAbi, functionName: "isEtherFiSafe", args: [safe] },
            { chainId: CHAIN, address: lens, abi: cashLensAbi, functionName: "getSafeCashData", args: [safe, []] },
            { chainId: CHAIN, address: dm, abi: debtManagerAbi, functionName: "getMaxBorrowAmount", args: [safe, false] },
            { chainId: CHAIN, address: safe, abi: etherFiSafeAbi, functionName: "getOwners" },
          ] as const)
        : [],
    query: { enabled, refetchInterval: LIVE_REFRESH_MS },
  });

  return useMemo<UseLiveSafe>(() => {
    const none = { live: null, owners: [] as Address[], isOwner: false, updatedAt: null, refetch: () => void q.refetch() };
    if (!enabled) return { status: "idle", ...none };
    const r = q.data as
      | [
          { status: string; result?: boolean },
          { status: string; result?: RawSafeCashData },
          { status: string; result?: bigint },
          { status: string; result?: readonly Address[] },
        ]
      | undefined;
    if (!r) return { status: q.isError ? "error" : "loading", ...none };
    const [isSafe, cash, liq, owners] = r;
    if (isSafe.status === "success" && isSafe.result === false) return { status: "not-safe", ...none };
    if (isSafe.status !== "success" || cash.status !== "success" || liq.status !== "success" || !cash.result || liq.result === undefined) {
      return { status: "error", ...none };
    }
    const ownerList = owners.status === "success" && owners.result ? [...owners.result] : [];
    return {
      status: "ready",
      live: parseSafeCashData(safe!, cash.result, liq.result),
      owners: ownerList,
      isOwner: !!wallet && ownerList.some((o) => o.toLowerCase() === wallet.toLowerCase()),
      updatedAt: q.dataUpdatedAt || Date.now(),
      refetch: () => void q.refetch(),
    };
  }, [enabled, q, safe, wallet]);
}
