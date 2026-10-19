"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isAddress, type Address } from "viem";

/**
 * Playground: a fully simulated account, no wallet needed (also the guest/demo experience).
 * Mainnet: reads a real Ether.fi Safe on Optimism (read-only) and checks card spends against the live contracts.
 */
export type AppMode = "playground" | "mainnet";

interface AppModeValue {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  /** The Ether.fi Safe being viewed in Mainnet mode. */
  linkedSafe: Address | null;
  setLinkedSafe: (a: Address | null) => void;
  walletModalOpen: boolean;
  openWalletModal: (opts?: { thenMainnet?: boolean }) => void;
  closeWalletModal: () => void;
  /** True when the modal was opened from the Mainnet toggle, so a successful connect should switch mode. */
  switchToMainnetOnConnect: boolean;
}

const Ctx = createContext<AppModeValue | null>(null);

const MODE_KEY = "oy.mode";
const SAFE_KEY = "oy.safe";

// localStorage can throw (private windows, blocked storage); the app must work without it.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>("playground");
  const [linkedSafe, setLinkedSafeState] = useState<Address | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [switchToMainnetOnConnect, setSwitch] = useState(false);

  // Restore after mount so server and client markup match.
  useEffect(() => {
    if (read(MODE_KEY) === "mainnet") setModeState("mainnet");
    const safe = read(SAFE_KEY);
    if (safe && isAddress(safe)) setLinkedSafeState(safe);
  }, []);

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
    write(MODE_KEY, m);
  }, []);

  const setLinkedSafe = useCallback((a: Address | null) => {
    setLinkedSafeState(a);
    write(SAFE_KEY, a);
  }, []);

  const openWalletModal = useCallback((opts?: { thenMainnet?: boolean }) => {
    setSwitch(!!opts?.thenMainnet);
    setWalletModalOpen(true);
  }, []);
  const closeWalletModal = useCallback(() => {
    setWalletModalOpen(false);
    setSwitch(false);
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, linkedSafe, setLinkedSafe, walletModalOpen, openWalletModal, closeWalletModal, switchToMainnetOnConnect }),
    [mode, setMode, linkedSafe, setLinkedSafe, walletModalOpen, openWalletModal, closeWalletModal, switchToMainnetOnConnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppMode(): AppModeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppMode must be used inside <AppModeProvider>");
  return v;
}
