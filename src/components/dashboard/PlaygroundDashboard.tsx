"use client";

import { useState } from "react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { BankCashout } from "@/components/dashboard/BankCashout";
import { CardManager } from "@/components/dashboard/CardManager";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { VaultOverview } from "@/components/dashboard/VaultOverview";
import { VoucherCenter } from "@/components/dashboard/VoucherCenter";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { useVaultState } from "@/features/vault/useVaultState";

type DashboardTab = "overview" | "pos" | "vouchers" | "cashout" | "activity";

/** The fully simulated account: no wallet needed. */
export function PlaygroundDashboard({ vault }: { vault: ReturnType<typeof useVaultState> }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  return (
    <div className="space-y-6" data-testid="playground-dashboard">
      {/* Navigation tabs: floating segmented pill bar */}
      <SegmentedTabs<DashboardTab>
        layoutId="pg-tab-pill"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "overview", label: "Vault & Card", icon: "🏛️" },
          { id: "pos", label: "POS Terminal Simulator", icon: "💳" },
          { id: "vouchers", label: "Voucher Store", icon: "🎁" },
          { id: "cashout", label: "1-Click Bank / UPI", icon: "🏦" },
          { id: "activity", label: `Ledger (${vault.transactions.length})`, icon: "📜" },
        ]}
      />

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
