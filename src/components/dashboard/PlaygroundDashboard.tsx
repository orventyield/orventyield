"use client";

import { useState } from "react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { BankCashout } from "@/components/dashboard/BankCashout";
import { CardManager } from "@/components/dashboard/CardManager";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { VaultOverview } from "@/components/dashboard/VaultOverview";
import dynamic from "next/dynamic";
import type { Activation } from "@/components/dashboard/ActivateCardDialog";
import { VoucherCenter } from "@/components/dashboard/VoucherCenter";
import { useIdentity } from "@/features/identity/IdentityProvider";
import type { useVaultState } from "@/features/vault/useVaultState";

// Loaded on demand: it pulls in the phone-number metadata, which most visits never need.
const ActivateCardDialog = dynamic(() => import("@/components/dashboard/ActivateCardDialog").then((m) => m.ActivateCardDialog), { ssr: false });

type DashboardTab = "overview" | "pos" | "vouchers" | "cashout" | "activity";

/** The fully simulated account: no wallet needed. */
export function PlaygroundDashboard({ vault }: { vault: ReturnType<typeof useVaultState> }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [activating, setActivating] = useState(false);
  const { owner } = useIdentity();

  const onActivated = (a: Activation) => {
    // Mirror the one-user-one-card rule in the engine; the verification service is the authority.
    if (a.identityId && owner) vault.activateCard(owner, a.identityId);
    else vault.setCardActive(true);
    // Cache for instant unlock on the next visit. Written only here, at the moment of a real activation.
    if (owner) {
      try {
        window.localStorage.setItem(`oy.card.${owner}`, "1");
      } catch {
        /* storage unavailable */
      }
    }
  };

  return (
    <div className="space-y-6" data-testid="playground-dashboard">
      {activating && <ActivateCardDialog open onClose={() => setActivating(false)} onActivated={onActivated} />}
      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-white/5 text-xs font-mono">
        {[
          { id: "overview", label: "Vault & Card", icon: "🏛️" },
          { id: "pos", label: "POS Terminal Simulator", icon: "💳" },
          { id: "vouchers", label: "Voucher Store", icon: "🎁" },
          { id: "cashout", label: "1-Click Bank / UPI", icon: "🏦" },
          { id: "activity", label: `Ledger (${vault.transactions.length})`, icon: "📜" },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as DashboardTab)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap font-medium ${
                active
                  ? "bg-cyan/15 text-cyan border border-cyan/40 shadow-sm shadow-cyan/20 font-bold"
                  : "bg-surface text-muted hover:text-fg hover:bg-surface-2 border border-white/5"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview (Vault + Card Manager) */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <VaultOverview
            principalUsd={vault.principalUsd}
            apyPercent={vault.apyPercent}
            accruedYieldUsd={vault.accruedYieldUsd}
            spendableUsd={vault.spendableUsd}
            timeScale={vault.timeScale}
            onTimeScale={vault.setTimeScale}
            onDeposit={vault.deposit}
            onWithdraw={vault.withdraw}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6">
              <CardManager
                card={vault.card}
                cardActive={vault.cardActive}
                onActivate={() => setActivating(true)}
                isCardFrozen={vault.isCardFrozen}
                onToggleFreeze={() => vault.setIsCardFrozen(!vault.isCardFrozen)}
                monthlyLimit={vault.monthlyLimit}
                onSetMonthlyLimit={vault.setMonthlyLimit}
                spentThisMonth={vault.spentThisMonth}
                spendableUsd={vault.spendableUsd}
              />
            </div>

            <div className="lg:col-span-6">
              <PosSimulator
                card={vault.card}
                isCardFrozen={vault.isCardFrozen}
                spendableUsd={vault.spendableUsd}
                onSpendCard={vault.spendCard}
              />
            </div>
          </div>

          {/* Recent Ledger preview */}
          <ActivityFeed transactions={vault.transactions.slice(0, 5)} />
        </div>
      )}

      {/* Tab 2: POS Simulator */}
      {activeTab === "pos" && (
        <div className="space-y-6">
          <PosSimulator
            card={vault.card}
            isCardFrozen={vault.isCardFrozen}
            spendableUsd={vault.spendableUsd}
            onSpendCard={vault.spendCard}
          />
          <ActivityFeed
            transactions={vault.transactions.filter((t) => t.type === "card_spend")}
          />
        </div>
      )}

      {/* Tab 3: Voucher Center */}
      {activeTab === "vouchers" && (
        <div className="space-y-6">
          <VoucherCenter
            accruedYieldUsd={vault.spendableUsd}
            onRedeemVoucher={vault.redeemVoucher}
          />
          <ActivityFeed
            transactions={vault.transactions.filter((t) => t.type === "voucher_redeem")}
          />
        </div>
      )}

      {/* Tab 4: 1-Click Bank Cashout */}
      {activeTab === "cashout" && (
        <div className="space-y-6">
          <BankCashout
            accruedYieldUsd={vault.spendableUsd}
            onCashout={vault.cashoutBank}
          />
          <ActivityFeed
            transactions={vault.transactions.filter((t) => t.type === "cashout")}
          />
        </div>
      )}

      {/* Tab 5: Complete Ledger */}
      {activeTab === "activity" && (
        <div>
          <ActivityFeed transactions={vault.transactions} />
        </div>
      )}
    </div>
  );
}
