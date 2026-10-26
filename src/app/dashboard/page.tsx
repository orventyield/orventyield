"use client";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { MainnetDashboard } from "@/components/dashboard/MainnetDashboard";
import { RobinhoodDashboard } from "@/components/dashboard/robinhood/RobinhoodDashboard";
import { PlaygroundDashboard } from "@/components/dashboard/PlaygroundDashboard";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { useVaultState } from "@/features/vault/useVaultState";

export default function DashboardPage() {
  const { mode, network } = useAppMode();
  // Lifted here so the playground account survives toggling to Mainnet and back.
  const vault = useVaultState();

  return (
    <div className="relative flex min-h-screen flex-col bg-bg font-sans text-fg">
      <div aria-hidden="true" className="ambient pointer-events-none fixed inset-0 -z-0" />

      <DashboardHeader onResetDemo={mode === "playground" ? vault.resetToDemo : undefined} />

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        {mode === "playground" ? <PlaygroundDashboard vault={vault} /> : network === "robinhood" ? <RobinhoodDashboard /> : <MainnetDashboard />}
      </main>
    </div>
  );
}
