"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { createIdentityClient, type IdentityClient } from "@/lib/identity/client";

interface IdentityValue {
  client: IdentityClient | null;
  /** Wallet address (lowercase) when connected, otherwise a per-browser guest id. Null until ready. */
  owner: string | null;
  isWallet: boolean;
  /** Ask the connected wallet to sign `message` (EIP-191). Rejects if the user declines. */
  sign: (message: string) => Promise<string>;
}

const Ctx = createContext<IdentityValue | null>(null);
const GUEST_KEY = "oy.guest";

function guestId(): string {
  try {
    const existing = window.localStorage.getItem(GUEST_KEY);
    if (existing && /^guest:[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  } catch {
    /* fall through */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = `guest:${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  try {
    window.localStorage.setItem(GUEST_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [client, setClient] = useState<IdentityClient | null>(null);
  const [guest, setGuest] = useState<string | null>(null);

  // Browser-only setup after mount.
  useEffect(() => {
    let alive = true;
    void createIdentityClient(process.env.NEXT_PUBLIC_VERIFY_API_URL || undefined).then((c) => alive && setClient(c));
    setGuest(guestId());
    return () => {
      alive = false;
    };
  }, []);

  const sign = useCallback((message: string) => signMessageAsync({ message }), [signMessageAsync]);

  const value = useMemo<IdentityValue>(() => {
    const wallet = isConnected && address ? address.toLowerCase() : null;
    return { client, owner: wallet ?? guest, isWallet: !!wallet, sign };
  }, [client, guest, address, isConnected, sign]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIdentity(): IdentityValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return v;
}
