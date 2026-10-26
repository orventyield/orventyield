"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ConnectGate } from "@/components/dashboard/MainnetDashboard";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import { CardPanel } from "@/components/dashboard/mainnet/CardPanel";
import { SpendShortcuts } from "@/components/dashboard/mainnet/SpendShortcuts";
import { MorphoVaultOverview, type MorphoModal } from "@/components/dashboard/robinhood/MorphoVaultOverview";
import { SpendingRailsBanner } from "@/components/dashboard/robinhood/SpendingRailsBanner";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { useMorphoAccount } from "@/features/account/useMorphoAccount";
import { useMorphoApy } from "@/features/account/useMorphoApy";
import { useCardSuite } from "@/features/card/useCardSuite";
import { buildLedger } from "@/features/ledger/mainnetLedger";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { ROBINHOOD_EXPLORER } from "@/lib/contracts/robinhood";
import { formatExpiry } from "@/lib/immersve/stage";
import { authCode, type CardDetails } from "@/utils/card";

type Tab = "overview" | "pos" | "vouchers" | "cashout" | "activity";

/** Mainnet on Robinhood Chain: 1:1 parity with Arbitrum layout (Vault, Card, Vouchers, Cashout, Activity). */
export function RobinhoodDashboard() {
  const m = useMorphoAccount();
  const { apy } = useMorphoApy();
  const { setNetwork } = useAppMode();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<MorphoModal>(null);
  const explorer = m.onFork ? undefined : ROBINHOOD_EXPLORER;

  const yieldMax = m.limits.yield;
  const principalMax = m.limits.principal;
  const suite = useCardSuite({
    maxYield: yieldMax,
    maxPrincipal: principalMax,
    pay: m.payFromYield,
    payPrincipal: m.payFromPrincipal,
    exec: m.execFromSafe,
  });

  const active = suite.cards?.find((c) => c.status === "active");
  const posCard: CardDetails | null = useMemo(() => {
    if (!active) return null;
    return {
      pan: active.panFirst6 + "******" + active.panLast4,
      cvv: "•••",
      expiry: formatExpiry(active.expiry),
      network: "mastercard",
    };
  }, [active]);

  const allowanceUsd = suite.cardBalanceCents / 100;
  const previewSpend = () => ({
    success: true,
    authCode: authCode("rh-card"),
    source: "mainnet-preview",
    txHash: "",
  });

  const snap = m.snapshot;
  const ledger = useMemo(
    () => (m.safe ? buildLedger(snap?.events ?? [], m.safe, [], explorer) : []),
    [m.safe, snap?.events, explorer],
  );

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
      <div data-testid="mainnet-loading" className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading your account">
        {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl glass-card" />)}
      </div>
    );
  }

  const close = () => {
    setModal(null);
    m.clearMessages();
  };
  const toArbitrum = () => {
    setNetwork("arbitrum");
    m.switchToArbitrum();
  };

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

      {/* Navigation tabs: identical layout to Arbitrum One */}
      <SegmentedTabs<Tab>
        layoutId="rh-tab-pill"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Vault & Card", icon: "🏛️", testId: "tab-vault" },
          { id: "pos", label: "POS Terminal Simulator", icon: "💳", testId: "tab-pos" },
          { id: "vouchers", label: "Voucher Store", icon: "🎁", testId: "tab-vouchers" },
          { id: "cashout", label: "1-Click Bank / UPI", icon: "🏦", testId: "tab-cashout" },
          { id: "activity", label: `Ledger (${ledger.length})`, icon: "📜", testId: "tab-activity" },
        ]}
      />

      {tab === "overview" && (
        <div className="space-y-6">
          <MorphoVaultOverview m={m} apy={apy} onOpen={setModal} />
          <SpendShortcuts onVouchers={() => setTab("vouchers")} onCashout={() => setTab("cashout")} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <CardPanel
                suite={suite}
                txSteps={m.steps}
                accountBusy={m.busy}
                explorer={explorer}
                onSpendVouchers={() => setTab("vouchers")}
                onSpendCashout={() => setTab("cashout")}
              />
            </div>
            <div className="lg:col-span-6">
              {posCard ? (
                <PosSimulator
                  card={posCard}
                  isCardFrozen={!!active?.isBlocked}
                  spendableUsd={allowanceUsd}
                  onSpendCard={previewSpend}
                  live
                />
              ) : (
                <div data-testid="pos-locked" className="h-full rounded-2xl glass-card p-5">
                  <h3 className="text-base font-bold text-fg">POS Merchant Terminal</h3>
                  <p className="mt-2 text-sm text-muted">
                    Get your virtual card and fund it with earned yield first. Then you can test a swipe at Uber, Starbucks or Amazon against the money on your card.
                  </p>
                </div>
              )}
            </div>
          </div>
          <ActivityFeed transactions={ledger.slice(0, 5)} live />
        </div>
      )}

      {tab === "pos" && (
        <div className="space-y-6">
          {posCard ? (
            <PosSimulator card={posCard} isCardFrozen={!!active?.isBlocked} spendableUsd={allowanceUsd} onSpendCard={previewSpend} live />
          ) : (
            <div className="rounded-2xl glass-card p-5 text-sm text-muted">Get your virtual card on the Vault &amp; Card tab to test spending here.</div>
          )}
          <ActivityFeed transactions={ledger.filter((t) => t.type === "card_spend")} live />
        </div>
      )}

      {tab === "vouchers" && (
        <div className="space-y-6">
          <SpendingRailsBanner onSwitch={toArbitrum} />
          <div className="rounded-2xl glass-card p-5" data-testid="spending-preview">
            <h3 className="text-base font-bold text-fg">Digital Voucher Store</h3>
            <p className="mt-1 text-sm text-muted">
              Redeem earned yield directly for Amazon, Swiggy, Uber and Flipkart gift vouchers on Arbitrum One.
            </p>
          </div>
          <ActivityFeed transactions={ledger.filter((t) => t.type === "voucher_redeem")} live />
        </div>
      )}

      {tab === "cashout" && (
        <div className="space-y-6">
          <SpendingRailsBanner onSwitch={toArbitrum} />
          <div className="rounded-2xl glass-card p-5" data-testid="spending-preview">
            <h3 className="text-base font-bold text-fg">1-Click Bank / UPI Cashout</h3>
            <p className="mt-1 text-sm text-muted">
              Cash out your accrued yield directly to your Indian bank account or UPI ID on Arbitrum One.
            </p>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-6">
          <ActivityFeed transactions={ledger} live />
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
