"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConnectGate } from "@/components/dashboard/MainnetDashboard";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import { MorphoVaultOverview, type MorphoModal } from "@/components/dashboard/robinhood/MorphoVaultOverview";
import { SpendingRailsBanner } from "@/components/dashboard/robinhood/SpendingRailsBanner";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { useMorphoAccount } from "@/features/account/useMorphoAccount";
import { useMorphoApy } from "@/features/account/useMorphoApy";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { ROBINHOOD_EXPLORER } from "@/lib/contracts/robinhood";

type Tab = "vault" | "vouchers" | "card" | "cashout";

const SPENDING: Record<Exclude<Tab, "vault">, { title: string; body: string }> = {
  vouchers: { title: "Digital Voucher Store", body: "Amazon, Uber, Swiggy and Zomato vouchers, paid from your earned yield." },
  card: { title: "Your virtual Mastercard", body: "Spend your earned yield anywhere Mastercard is accepted." },
  cashout: { title: "1-Click Bank / UPI Cashout", body: "Pay out earned yield to your bank account or UPI." },
};

/** Mainnet on Robinhood Chain: the Vault tab (Safe + Morpho, USDG) and the spending tabs, which point back to Arbitrum One. */
export function RobinhoodDashboard() {
  const m = useMorphoAccount();
  const { apy } = useMorphoApy();
  const { setNetwork } = useAppMode();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("vault");
  const [modal, setModal] = useState<MorphoModal>(null);
  const explorer = m.onFork ? undefined : ROBINHOOD_EXPLORER;

  if (m.status === "disconnected") return <ConnectGate />;
  if (m.status === "error") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl glass-card p-5 text-center">
        <div data-testid="mainnet-error" className="space-y-4 py-4">
          <h2 className="text-xl font-bold text-fg">Could not load your Robinhood Chain position</h2>
          <p className="text-sm text-muted">The network did not answer. Nothing was sent. Please try again.</p>
          <button type="button" onClick={() => void qc.invalidateQueries()} className="min-h-12 rounded-xl bg-cyan px-8 text-sm font-semibold text-bg hover:brightness-110">Try again</button>
        </div>
      </div>
    );
  }
  if (m.status === "loading") {
    return (
      <div data-testid="mainnet-loading" className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading your account">
        {[0, 1].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl glass-card" />)}
      </div>
    );
  }

  const close = () => {
    setModal(null);
    m.clearMessages();
  };
  const toArbitrum = () => {
    setNetwork("arbitrum");
    m.switchToArbitrum(); // the wallet follows; a refusal in the wallet leaves the app on Arbitrum with the notice below
  };
  const snap = m.snapshot;

  return (
    <div className="space-y-6" data-testid="rh-dashboard">
      {m.wrongChain && (
        <div data-testid="network-notice" role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-muted">
          <span>
            Connected on <span className="font-semibold text-fg">{m.walletChainName ?? "another network"}</span>. Everything here still loads; we switch to Robinhood Chain for you when you deposit or withdraw.
          </span>
          <button type="button" data-testid="switch-network" onClick={m.switchToRobinhood} className="min-h-9 rounded-lg border border-white/10 px-3 font-semibold text-fg hover:bg-white/5">Switch to Robinhood Chain</button>
        </div>
      )}

      <SegmentedTabs<Tab>
        layoutId="rh-tab-pill"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "vault", label: "Vault", icon: "🏛️", testId: "tab-vault" },
          { id: "vouchers", label: "Voucher Store", icon: "🎁", testId: "tab-vouchers" },
          { id: "card", label: "Card", icon: "💳", testId: "tab-card" },
          { id: "cashout", label: "Bank / UPI", icon: "🏦", testId: "tab-cashout" },
        ]}
      />

      {tab === "vault" ? (
        <MorphoVaultOverview m={m} apy={apy} onOpen={setModal} />
      ) : (
        <div className="space-y-4">
          <SpendingRailsBanner onSwitch={toArbitrum} />
          <div className="rounded-2xl glass-card p-5 opacity-80" data-testid="spending-preview">
            <h3 className="text-base font-bold text-fg">{SPENDING[tab].title}</h3>
            <p className="mt-1 text-sm text-muted">{SPENDING[tab].body}</p>
          </div>
        </div>
      )}

      <AmountDialog
        open={modal === "deposit"}
        onClose={close}
        testId="deposit-dialog"
        networkBadge="Robinhood Chain · USDG"
        asset="USDG"
        title="Deposit USDG"
        intro="Your USDG goes into the Steakhouse USDG vault (Morpho) from your own Safe. You can withdraw your principal any time."
        max={m.walletUsdg}
        maxLabel="In your wallet"
        confirmLabel="Deposit"
        preview={[
          ...(m.deployed ? [] : [{ label: "Create your Safe", detail: "One-time: the Safe v1.4.1 factory deploys your personal smart account on Robinhood Chain. You are its only owner." }]),
          { label: "Approve USDG", detail: "Lets the vault take exactly the amount you entered, nothing more." },
          { label: "Deposit into the vault", detail: "Deposits your USDG into the Morpho Steakhouse USDG vault for your Safe, where it earns yield." },
        ]}
        steps={m.steps}
        busy={m.busy}
        error={m.error}
        success={modal === "deposit" ? m.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void m.deposit(v)}
      />

      <AmountDialog
        open={modal === "yield"}
        onClose={close}
        testId="yield-dialog"
        asset="USDG"
        title="Withdraw yield"
        intro="Only the yield you have earned can leave. Your principal stays in the vault."
        max={m.limits.yield}
        maxLabel="Yield available"
        confirmLabel="Withdraw yield"
        preview={[{ label: "Withdraw yield", detail: "Your Safe takes the yield out of the vault and sends it to your wallet in one transaction." }]}
        steps={m.steps}
        busy={m.busy}
        error={m.error}
        success={modal === "yield" ? m.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void m.withdrawYield(v, true)}
      />

      <AmountDialog
        open={modal === "principal"}
        onClose={close}
        testId="principal-dialog"
        asset="USDG"
        title="Withdraw principal"
        intro="This takes money out of the vault, so it stops earning on that amount."
        max={snap ? m.limits.principal : 0n}
        maxLabel="Principal"
        confirmLabel="Withdraw principal"
        preview={[{ label: "Withdraw principal", detail: "Your Safe takes the amount out of the vault and sends it straight to your wallet." }]}
        steps={m.steps}
        busy={m.busy}
        error={m.error}
        success={modal === "principal" ? m.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void m.withdrawPrincipal(v)}
      />
    </div>
  );
}
