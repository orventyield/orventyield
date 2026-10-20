"use client";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { MainnetDashboard } from "@/components/dashboard/MainnetDashboard";
import { PlaygroundDashboard } from "@/components/dashboard/PlaygroundDashboard";
import { useIdentity } from "@/features/identity/IdentityProvider";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { useVaultState } from "@/features/vault/useVaultState";
import { useEffect } from "react";

export default function DashboardPage() {
  const { mode } = useAppMode();
  // Lifted here so the playground account survives toggling to Mainnet and back.
  const vault = useVaultState();
  const { client, owner } = useIdentity();
  const setCardActive = vault.setCardActive;

  // The card belongs to whoever owns it (wallet or guest). Ask the verification service when that changes.
  useEffect(() => {
    if (!client || !owner) return;
    const key = `oy.card.${owner}`;
    let cached = false;
    try {
      cached = window.localStorage.getItem(key) === "1";
    } catch {
      /* storage unavailable */
    }
    setCardActive(cached); // instant, then confirmed below
    let alive = true;
    client
      .status(owner)
      .then((active) => {
        if (!alive) return;
        setCardActive(active);
        try {
          if (active) window.localStorage.setItem(key, "1");
          else window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* offline: keep the cached state */
      });
    return () => {
      alive = false;
    };
  }, [client, owner, setCardActive]);

  return (
    <div className="relative flex min-h-screen flex-col bg-bg font-sans text-fg">
      <div aria-hidden="true" className="ambient pointer-events-none fixed inset-0 -z-0" />

      <DashboardHeader onResetDemo={mode === "playground" ? vault.resetToDemo : undefined} />

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        {mode === "playground" ? <PlaygroundDashboard vault={vault} /> : <MainnetDashboard />}
      </main>
    </div>
  );
}
