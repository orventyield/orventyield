"use client";

import { useState } from "react";
import type { Receipt, SpendResult } from "@/features/vault/useVaultState";
import { shortHash, type CardDetails } from "@/utils/card";

interface PosSimulatorProps {
  card: CardDetails;
  isCardFrozen: boolean;
  /** Earned yield: the only thing a swipe can spend. */
  spendableUsd: number;
  onSpendCard: (amountUsd: number, merchant: string) => SpendResult | Promise<SpendResult>;
  /** Mainnet: a preview against real earned yield. Nothing is charged. */
  live?: boolean;
}

interface MerchantPreset {
  name: string;
  amount: number;
  icon: string;
}

const PRESET_MERCHANTS: MerchantPreset[] = [
  { name: "Starbucks Coffee", amount: 4.85, icon: "☕" },
  { name: "Uber Ride", amount: 16.5, icon: "🚗" },
  { name: "Netflix Subscription", amount: 19.99, icon: "🎬" },
  { name: "Apple Store Gadget", amount: 149.0, icon: "🍎" },
];

const LATENCY_BUDGET_MS = 300;

const money = (n: number) => `$${n.toFixed(2)}`;

export function PosSimulator({
  card,
  isCardFrozen,
  spendableUsd,
  onSpendCard,
  live = false,
}: PosSimulatorProps) {
  const [selectedMerchant, setSelectedMerchant] = useState<string>(PRESET_MERCHANTS[0]!.name);
  const [amountInput, setAmountInput] = useState<string>(PRESET_MERCHANTS[0]!.amount.toString());
  const [customMerchant, setCustomMerchant] = useState("");
  const [terminal, setTerminal] = useState<{ text: string; tone: "idle" | "ok" | "declined" }>({
    text: "READY FOR TAP / INSERT",
    tone: "idle",
  });
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [checking, setChecking] = useState(false);

  const isCustom = selectedMerchant === "Custom";
  const merchantName = isCustom ? customMerchant.trim() || "Retail Merchant" : selectedMerchant;
  const amount = parseFloat(amountInput);
  const amountValid = Number.isFinite(amount) && amount > 0;

  const selectPreset = (m: MerchantPreset) => {
    setSelectedMerchant(m.name);
    setAmountInput(m.amount.toString());
    setCustomMerchant("");
  };

  const tap = async () => {
    if (!amountValid) {
      setTerminal({ text: "DECLINED: INVALID AMOUNT", tone: "declined" });
      setReceipt(null);
      setLatencyMs(null);
      return;
    }
    const t0 = performance.now();
    setChecking(true);
    const result = await onSpendCard(amount, merchantName);
    setChecking(false);
    setLatencyMs(result.latencyMs ?? performance.now() - t0);

    if (!result.success) {
      setTerminal({ text: `DECLINED: ${result.error ?? "DECLINED"}`, tone: "declined" });
      setReceipt(null);
      return;
    }
    setTerminal({ text: `APPROVED · AUTH ${result.receipt?.authCode ?? ""}`, tone: "ok" });
    setReceipt(result.receipt ?? null);
  };

  const toneClass =
    terminal.tone === "declined" ? "text-danger" : terminal.tone === "ok" ? "text-emerald" : "text-emerald/80";
  const within = latencyMs !== null && latencyMs < LATENCY_BUDGET_MS;

  return (
    <div className="glass-card rounded-2xl p-5 space-y-5">
      <div>
        <h3 className="text-base font-bold text-fg flex flex-wrap items-center gap-2">
          POS Merchant Terminal
          <span className="text-xs px-2 py-0.5 rounded bg-cyan/10 border border-cyan/20 text-cyan font-mono">
            {live ? "card preview" : "playground"}
          </span>
        </h3>
        <p className="text-xs text-muted mt-0.5">
          {live ? "Tests a swipe against the money on your card. Nothing is charged." : "Simulates a contactless swipe paid from your earned yield. Your principal is never used."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Merchant selection */}
        <div className="lg:col-span-6 space-y-3">
          <p className="text-xs font-mono text-muted uppercase tracking-wider">1. Choose a merchant</p>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_MERCHANTS.map((m) => {
              const active = selectedMerchant === m.name;
              return (
                <button
                  key={m.name}
                  type="button"
                  data-testid={`preset-${m.name.split(" ")[0]!.toLowerCase()}`}
                  aria-pressed={active}
                  onClick={() => selectPreset(m)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    active
                      ? "bg-cyan/10 border-cyan/50 text-fg shadow-sm shadow-cyan/20"
                      : "bg-white/[0.05] border-white/5 text-muted hover:text-fg hover:border-white/10"
                  }`}
                >
                  <div className="text-xl mb-1" aria-hidden="true">{m.icon}</div>
                  <div className="text-xs font-semibold">{m.name}</div>
                  <div className="text-xs font-mono text-cyan mt-0.5">{money(m.amount)}</div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            data-testid="preset-custom"
            aria-pressed={isCustom}
            onClick={() => setSelectedMerchant("Custom")}
            className={`w-full p-2.5 rounded-xl border text-xs font-semibold transition-all ${
              isCustom ? "bg-cyan/10 border-cyan/50 text-cyan" : "bg-white/[0.05] border-white/5 text-muted hover:text-fg"
            }`}
          >
            Custom merchant and amount
          </button>

          {isCustom && (
            <div className="space-y-2 p-3 bg-white/[0.05] rounded-xl border border-white/5">
              <div>
                <label htmlFor="pos-merchant" className="text-[11px] font-mono text-muted">Merchant name</label>
                <input
                  id="pos-merchant"
                  data-testid="custom-merchant"
                  type="text"
                  maxLength={40}
                  placeholder="e.g. Target, Zara"
                  value={customMerchant}
                  onChange={(e) => setCustomMerchant(e.target.value)}
                  className="w-full glass-card border border-white/10 rounded-lg px-3 py-2 text-xs text-fg font-mono outline-none focus:border-cyan"
                />
              </div>
              <div>
                <label htmlFor="pos-amount" className="text-[11px] font-mono text-muted">Amount (USD)</label>
                <input
                  id="pos-amount"
                  data-testid="custom-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full glass-card border border-white/10 rounded-lg px-3 py-2 text-xs text-fg font-mono outline-none focus:border-cyan"
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/5 bg-white/[0.05] p-3 text-[11px] font-mono text-muted space-y-1">
            <div className="flex justify-between"><span>{live ? "Card balance" : "Earned yield you can spend"}</span><span data-testid="pos-spendable" className="text-emerald">{money(spendableUsd)}</span></div>
          </div>
        </div>

        {/* Terminal */}
        <div className="lg:col-span-6 flex flex-col justify-between bg-[#050608] border border-white/10 rounded-2xl p-4 shadow-inner">
          <div className="bg-[#0b100d] border border-emerald/20 rounded-xl p-3 font-mono text-xs space-y-1.5">
            <div className="flex justify-between border-b border-emerald/20 pb-1 text-[11px] text-emerald/80">
              <span>ORVENT-POS</span>
              <span>{card.network === "visa" ? "VISA" : "MASTERCARD"}</span>
            </div>
            <div className="text-center py-2">
              <div className="text-muted/80 text-[10px]">MERCHANT: {merchantName.toUpperCase()}</div>
              <div className="text-2xl font-bold text-fg tracking-tight my-1 tabular">
                {amountValid ? money(amount) : "$0.00"}
              </div>
              <div data-testid="pos-terminal" role="status" aria-live="polite" className={`text-[11px] font-semibold ${toneClass}`}>
                {terminal.text}
              </div>
            </div>
            <div className="flex justify-between border-t border-emerald/20 pt-1 text-[10px] text-emerald/60">
              <span>Card •••• {card.pan.slice(-4)}</span>
              <span>{isCardFrozen ? "FROZEN" : "UNLOCKED"}</span>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              data-testid="pos-pay"
              onClick={() => void tap()}
              disabled={checking}
              className={`w-full py-3.5 disabled:cursor-wait disabled:opacity-70 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                isCardFrozen
                  ? "bg-danger/20 border border-danger/40 text-danger hover:bg-danger/30"
                  : "bg-cyan text-bg hover:brightness-110 shadow-lg shadow-cyan/20"
              }`}
            >
              <span aria-hidden="true">💳</span>
              Tap to Pay {amountValid ? money(amount) : ""}
            </button>
            <div className="flex justify-between text-[11px] font-mono text-muted/70 px-1">
              <span data-testid="pos-latency">
                {latencyMs === null ? "Auth latency: n/a" : `Auth latency: ${latencyMs.toFixed(1)} ms`}
                {latencyMs !== null && (
                  <span className={within ? " text-emerald" : " text-danger"}>
                    {" "}
                    ({within ? "<" : "≥"} {LATENCY_BUDGET_MS} ms)
                  </span>
                )}
              </span>
              <span>Fee: $0.00</span>
            </div>
            <p className="px-1 text-[10px] text-muted/50">Local decision time.</p>
          </div>

          {receipt && (
            <div data-testid="pos-receipt" className="mt-4 bg-white/[0.05] border border-white/10 rounded-xl p-3 font-mono text-xs text-muted space-y-1">
              <div className="flex justify-between text-fg font-bold border-b border-white/5 pb-1">
                <span>RECEIPT</span>
                <span className="text-emerald">APPROVED</span>
              </div>
              <Row k="Merchant" v={receipt.merchant} />
              <Row k="Amount" v={money(receipt.amountUsd)} strong />
              <Row k="Auth code" v={receipt.authCode} testId="receipt-auth" />
              <Row k="Auth time" v={receipt.timestampIso} />
              {receipt.funding && <Row k="Funded by earned yield" v={money(receipt.funding.fromYield)} testId="receipt-funding" />}
              <Row
                k="Verified by"
                v={receipt.source === "mainnet-preview" ? "Your card balance" : "Playground engine"}
                testId="receipt-source"
              />
              {receipt.txHash ? (
                <div className="flex justify-between">
                  <span>Sim tx hash</span>
                  <span data-testid="receipt-hash" title={receipt.txHash} className="text-cyan">{shortHash(receipt.txHash)}</span>
                </div>
              ) : null}
              <div className="pt-1 text-[10px] text-muted/70 border-t border-white/5">
                {receipt.source === "mainnet-preview" ? "Preview: nothing was charged and no transaction was sent." : "Playground: no on-chain transaction was sent."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, strong, testId }: { k: string; v: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{k}</span>
      <span data-testid={testId} className={strong ? "text-fg font-bold" : "text-fg"}>{v}</span>
    </div>
  );
}
