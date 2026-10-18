"use client";

import { useState } from "react";
import { useVaultState } from "@/features/vault/useVaultState";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { VaultOverview } from "@/components/dashboard/VaultOverview";
import { CardManager } from "@/components/dashboard/CardManager";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { VoucherCenter } from "@/components/dashboard/VoucherCenter";
import { BankCashout } from "@/components/dashboard/BankCashout";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";

type DashboardTab = "overview" | "pos" | "vouchers" | "cashout" | "activity";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const vault = useVaultState();

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col font-sans">
      {/* Top Header */}
      <DashboardHeader
        isSandboxMode={vault.isSandboxMode}
        setIsSandboxMode={vault.setIsSandboxMode}
        onResetDemo={vault.resetToDemo}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
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
              selectedToken={vault.selectedToken}
              onSelectToken={vault.setSelectedToken}
              collateralAmount={vault.collateralAmount}
              collateralUsd={vault.collateralUsd}
              activeDebtUsd={vault.activeDebtUsd}
              accruedYieldUsd={vault.accruedYieldUsd}
              availableLimit={vault.availableLimit}
              healthFactor={vault.healthFactor}
              healthStatus={vault.healthStatus}
              microBuffer={vault.microBuffer}
              onDeposit={vault.deposit}
              onWithdraw={vault.withdraw}
              onRepayWithYield={vault.repayDebtWithYield}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6">
                <CardManager
                  isCardFrozen={vault.isCardFrozen}
                  onToggleFreeze={() => vault.setIsCardFrozen(!vault.isCardFrozen)}
                  monthlyLimit={vault.monthlyLimit}
                  onSetMonthlyLimit={vault.setMonthlyLimit}
                  spentThisMonth={vault.spentThisMonth}
                  microBuffer={vault.microBuffer}
                  availableLimit={vault.availableLimit}
                />
              </div>

              <div className="lg:col-span-6">
                <PosSimulator
                  isCardFrozen={vault.isCardFrozen}
                  availableLimit={vault.availableLimit}
                  microBuffer={vault.microBuffer}
                  healthFactor={vault.healthFactor}
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
              isCardFrozen={vault.isCardFrozen}
              availableLimit={vault.availableLimit}
              microBuffer={vault.microBuffer}
              healthFactor={vault.healthFactor}
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
              accruedYieldUsd={vault.accruedYieldUsd}
              availableLimit={vault.availableLimit}
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
              accruedYieldUsd={vault.accruedYieldUsd}
              availableLimit={vault.availableLimit}
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
      </main>
    </div>
  );
}
