"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { linkCard, markTestSent, markVerified, parseLinkedCards, storageKey, unlinkCard, validateCardAddress, type CardNetwork, type CardProvider, type LinkedCard, type ProviderId } from "@/lib/linkedCards/cards";

function read(owner: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(owner));
  } catch {
    return null; // storage blocked: the feature still works for this session, it just is not remembered
  }
}
function write(owner: string, list: LinkedCard[]) {
  try {
    window.localStorage.setItem(storageKey(owner), JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/**
 * The user's linked cards for one wallet, kept in this browser only (no server, no database). Only the provider, the public
 * deposit address and the step reached are saved: nothing secret. Records are re-validated on every read and again before
 * any send, so a tampered entry can never be used.
 */
export function useLinkedCards(owner: Address | undefined, network: CardNetwork, own: readonly (string | undefined)[]) {
  const ownKey = own.map((o) => o?.toLowerCase() ?? "").join(",");
  const ownList = useMemo(() => ownKey.split(",").filter(Boolean), [ownKey]);
  const [state, setState] = useState<{ owner?: string; list: LinkedCard[] }>({ list: [] });

  // Load when the wallet changes; a different wallet must never see the previous wallet's cards.
  useEffect(() => {
    setState({ owner: owner?.toLowerCase(), list: owner ? parseLinkedCards(read(owner), []) : [] });
  }, [owner]);

  const update = useCallback((fn: (list: LinkedCard[]) => LinkedCard[]) => {
    setState((prev) => {
      if (!prev.owner) return prev;
      const list = fn(prev.list);
      write(prev.owner, list);
      return { owner: prev.owner, list };
    });
  }, []);

  // Anything that is now your own wallet or Safe, or no longer valid, is hidden (and never sendable).
  const cards = useMemo(() => state.list.filter((c) => c.network === network && validateCardAddress(c.address, { network, own: ownList }).ok), [state.list, network, ownList]);

  return {
    cards,
    link: useCallback((provider: CardProvider, address: Address) => update((l) => linkCard(l, provider, address, Date.now())), [update]),
    markTestSent: useCallback((id: ProviderId) => update((l) => markTestSent(l, id)), [update]),
    markVerified: useCallback((id: ProviderId) => update((l) => markVerified(l, id)), [update]),
    unlink: useCallback((id: ProviderId) => update((l) => unlinkCard(l, id)), [update]),
  };
}
