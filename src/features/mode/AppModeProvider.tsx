"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Playground: a fully simulated account, no wallet needed (also the guest/demo experience).
 * Mainnet: the user's own Safe + Aave v3 account on Arbitrum One.
 */
export type AppMode = "playground" | "mainnet";
/** Which yield engine the Mainnet dashboard shows: Aave on Arbitrum One, or Morpho on Robinhood Chain. */
export type AppNetwork = "arbitrum" | "robinhood";

interface AppModeValue {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  network: AppNetwork;
  setNetwork: (n: AppNetwork) => void;
  walletModalOpen: boolean;
  openWalletModal: (opts?: { thenMainnet?: boolean }) => void;
  closeWalletModal: () => void;
  /** True when the modal was opened from the Mainnet toggle, so a successful connect should switch mode. */
  switchToMainnetOnConnect: boolean;
}

const Ctx = createContext<AppModeValue | null>(null);

const MODE_KEY = "oy.mode";
const NETWORK_KEY = "oy.network";

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
  const [network, setNetworkState] = useState<AppNetwork>("arbitrum");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [switchToMainnetOnConnect, setSwitch] = useState(false);

  // Restore after mount so server and client markup match.
  useEffect(() => {
    if (read(MODE_KEY) === "mainnet") setModeState("mainnet");
    if (read(NETWORK_KEY) === "robinhood") setNetworkState("robinhood");
    write("oy.safe", null); // legacy key from the removed watch-a-Safe feature
  }, []);

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
    write(MODE_KEY, m);
  }, []);

  const setNetwork = useCallback((n: AppNetwork) => {
    setNetworkState(n);
    write(NETWORK_KEY, n);
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
    () => ({ mode, setMode, network, setNetwork, walletModalOpen, openWalletModal, closeWalletModal, switchToMainnetOnConnect }),
    [mode, setMode, network, setNetwork, walletModalOpen, openWalletModal, closeWalletModal, switchToMainnetOnConnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppMode(): AppModeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppMode must be used inside <AppModeProvider>");
  return v;
}
