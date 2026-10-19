"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { resolveSafes } from "./safeIndex";

export type ResolveStatus = "idle" | "resolving" | "found" | "none" | "error";

export interface ResolvedSafes {
  status: ResolveStatus;
  safes: Address[];
  /** The prebuilt index was reachable. When false, "none" may just mean "could not tell". */
  indexAvailable: boolean;
}

const TTL_MS = 10 * 60_000;
const key = (owner: string) => `oy.safes.${owner.toLowerCase()}`;

function readCache(owner: string): Address[] | null {
  try {
    const raw = window.sessionStorage.getItem(key(owner));
    if (!raw) return null;
    const { at, safes } = JSON.parse(raw) as { at: number; safes: Address[] };
    return Date.now() - at < TTL_MS && safes.length ? safes : null;
  } catch {
    return null;
  }
}

/** Finds the connected wallet's Ether.fi Safe(s) on Optimism automatically. Pass null to stay idle. */
export function useResolvedSafes(owner: string | null): ResolvedSafes {
  const client = usePublicClient({ chainId: 10 });
  const [state, setState] = useState<ResolvedSafes>({ status: "idle", safes: [], indexAvailable: true });

  useEffect(() => {
    if (!owner || !client) {
      setState({ status: "idle", safes: [], indexAvailable: true });
      return;
    }
    const cached = readCache(owner);
    if (cached) {
      setState({ status: "found", safes: cached, indexAvailable: true });
      return;
    }
    let alive = true;
    setState({ status: "resolving", safes: [], indexAvailable: true });
    resolveSafes(client as never, owner)
      .then((r) => {
        if (!alive) return;
        setState({ status: r.safes.length ? "found" : "none", safes: r.safes, indexAvailable: r.indexAvailable });
        if (r.safes.length) {
          try {
            window.sessionStorage.setItem(key(owner), JSON.stringify({ at: Date.now(), safes: r.safes }));
          } catch {
            /* storage unavailable */
          }
        }
      })
      .catch(() => alive && setState({ status: "error", safes: [], indexAvailable: true }));
    return () => {
      alive = false;
    };
  }, [owner, client]);

  return state;
}
