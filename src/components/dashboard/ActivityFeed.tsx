"use client";

import { useState } from "react";
import { type Transaction } from "@/features/vault/useVaultState";

interface ActivityFeedProps {
  transactions: Transaction[];
}

export function ActivityFeed({ transactions }: ActivityFeedProps) {
  const [filter, setFilter] = useState<"all" | "card_spend" | "voucher_redeem" | "deposit" | "yield_repay" | "cashout">("all");

  const filtered = transactions.filter((t) => {
    if (filter === "all") return true;
    return t.type === filter;
  });

  const getBadgeClass = (type: Transaction["type"]) => {
    switch (type) {
      case "deposit":
        return "bg-emerald/10 border-emerald/30 text-emerald";
      case "withdraw":
        return "bg-amber/10 border-amber/30 text-amber";
      case "card_spend":
        return "bg-cyan/10 border-cyan/30 text-cyan";
      case "voucher_redeem":
        return "bg-purple-500/10 border-purple-500/30 text-purple-400";
      case "yield_repay":
        return "bg-emerald/10 border-emerald/30 text-emerald";
      case "cashout":
        return "bg-blue-500/10 border-blue-500/30 text-blue-400";
    }
  };

  const getTypeIcon = (type: Transaction["type"]) => {
    switch (type) {
      case "deposit":
        return "📥";
      case "withdraw":
        return "📤";
      case "card_spend":
        return "💳";
      case "voucher_redeem":
        return "🎁";
      case "yield_repay":
        return "⚡";
      case "cashout":
        return "🏦";
    }
  };

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-fg flex items-center gap-2">
            Non-Custodial Ledger & Activity
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-muted font-mono">
              {transactions.length} Total
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Immutable log of all card swipes, voucher redemptions, and smart contract state changes.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs">
          {(
            [
              { id: "all", label: "All" },
              { id: "card_spend", label: "Cards" },
              { id: "voucher_redeem", label: "Vouchers" },
              { id: "deposit", label: "Deposits" },
              { id: "yield_repay", label: "Repayments" },
              { id: "cashout", label: "Cashouts" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg font-mono transition-all whitespace-nowrap ${
                filter === f.id
                  ? "bg-cyan/15 text-cyan border border-cyan/30 font-semibold"
                  : "bg-surface-2 border border-white/5 text-muted hover:text-fg"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs font-mono text-muted">
            No transactions found for this filter.
          </div>
        ) : (
          filtered.map((tx) => (
            <div
              key={tx.id}
              className="bg-surface-2 border border-white/5 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-white/10 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-surface border border-white/5 flex items-center justify-center text-lg">
                  {getTypeIcon(tx.type)}
                </div>
                <div>
                  <div className="text-xs font-semibold text-fg flex items-center gap-2">
                    <span>{tx.title}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${getBadgeClass(tx.type)}`}>
                      {tx.type.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-muted/70 flex items-center gap-3 mt-0.5">
                    <span>{new Date(tx.timestamp).toLocaleString()}</span>
                    <span>•</span>
                    <span className="text-cyan/80">Tx: {tx.txHash}</span>
                    {tx.voucherCode && (
                      <>
                        <span>•</span>
                        <span className="text-emerald font-semibold">Code: {tx.voucherCode}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                <span className="text-sm font-bold font-mono text-fg tabular">
                  {tx.type === "deposit" || tx.type === "yield_repay" ? "+" : "-"}
                  ${tx.amountUsd.toFixed(2)}
                </span>
                <span className="text-[10px] text-emerald font-mono flex items-center gap-1">
                  ✓ Ether.fi Verified
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
