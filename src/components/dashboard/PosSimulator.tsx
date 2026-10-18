"use client";

import { useState } from "react";
import { type Transaction } from "@/features/vault/useVaultState";

interface PosSimulatorProps {
  isCardFrozen: boolean;
  availableLimit: number;
  microBuffer: number;
  healthFactor: number;
  onSpendCard: (
    amountUsd: number,
    merchant: string
  ) => { success: boolean; error?: string; tx?: Transaction };
}

interface MerchantPreset {
  name: string;
  amount: number;
  icon: string;
}

const PRESET_MERCHANTS: MerchantPreset[] = [
  { name: "Starbucks Coffee", amount: 4.85, icon: "☕" },
  { name: "Uber Ride", amount: 16.5, icon: "🚗" },
  { name: "Netflix 4K UHD", amount: 19.99, icon: "🎬" },
  { name: "Apple Store", amount: 149.0, icon: "🍎" },
];

export function PosSimulator({
  isCardFrozen,
  availableLimit,
  microBuffer,
  healthFactor,
  onSpendCard,
}: PosSimulatorProps) {
  const [selectedMerchant, setSelectedMerchant] = useState<string>(PRESET_MERCHANTS[0]!.name);
  const [customAmount, setCustomAmount] = useState<string>(PRESET_MERCHANTS[0]!.amount.toString());
  const [customMerchant, setCustomMerchant] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{
    merchant: string;
    amount: number;
    authCode: string;
    postHf: number;
    txHash: string;
    timestamp: string;
  } | null>(null);

  const handlePresetSelect = (m: MerchantPreset) => {
    setSelectedMerchant(m.name);
    setCustomAmount(m.amount.toString());
    setCustomMerchant("");
  };

  const handleCustomSelect = () => {
    setSelectedMerchant("Custom");
  };

  const handleSwipeSubmit = () => {
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) {
      setTerminalMessage("ERROR: INVALID AMOUNT");
      return;
    }

    const merchantName =
      selectedMerchant === "Custom"
        ? customMerchant.trim() || "Retail Merchant"
        : selectedMerchant;

    setIsProcessing(true);
    setTerminalMessage("CONTACTING ETHER.FI CASH MODULE...");

    // Simulate realistic sub-300ms verification
    setTimeout(() => {
      const result = onSpendCard(amount, merchantName);
      setIsProcessing(false);

      if (!result.success) {
        setTerminalMessage(`DECLINED: ${result.error?.toUpperCase()}`);
        setLastReceipt(null);
      } else {
        const auth = "AUTH-" + Math.floor(100000 + Math.random() * 900000);
        setTerminalMessage("TRANSACTION APPROVED! PRINTING RECEIPT...");
        setLastReceipt({
          merchant: merchantName,
          amount,
          authCode: auth,
          postHf: healthFactor,
          txHash: result.tx?.txHash || "0x7a8b...19e4",
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    }, 280);
  };

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-fg flex items-center gap-2">
            POS Merchant Terminal Simulator
            <span className="text-xs px-2 py-0.5 rounded bg-cyan/10 border border-cyan/20 text-cyan font-mono">
              sub-300ms
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Test real-world contactless card swipes against your yield credit line.
          </p>
        </div>
      </div>

      {/* POS Terminal Machine Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Preset selection */}
        <div className="lg:col-span-6 space-y-3">
          <label className="text-xs font-mono text-muted uppercase tracking-wider block">
            1. Select Demo Merchant or Custom
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_MERCHANTS.map((m) => {
              const active = selectedMerchant === m.name;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => handlePresetSelect(m)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    active
                      ? "bg-cyan/10 border-cyan/50 text-fg shadow-sm shadow-cyan/20"
                      : "bg-surface-2 border-white/5 text-muted hover:text-fg hover:border-white/10"
                  }`}
                >
                  <div className="text-xl mb-1">{m.icon}</div>
                  <div className="text-xs font-semibold">{m.name}</div>
                  <div className="text-xs font-mono text-cyan mt-0.5">${m.amount.toFixed(2)}</div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleCustomSelect}
            className={`w-full p-2.5 rounded-xl border text-xs font-semibold transition-all ${
              selectedMerchant === "Custom"
                ? "bg-cyan/10 border-cyan/50 text-cyan"
                : "bg-surface-2 border-white/5 text-muted hover:text-fg"
            }`}
          >
            Or Enter Custom Amount / Merchant
          </button>

          {selectedMerchant === "Custom" && (
            <div className="space-y-2 p-3 bg-surface-2 rounded-xl border border-white/5 animate-in fade-in">
              <div>
                <label className="text-[11px] font-mono text-muted">Merchant Name</label>
                <input
                  type="text"
                  placeholder="e.g. Target, Zara, Whole Foods"
                  value={customMerchant}
                  onChange={(e) => setCustomMerchant(e.target.value)}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-xs text-fg font-mono outline-none focus:border-cyan"
                />
              </div>
              <div>
                <label className="text-[11px] font-mono text-muted">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-xs text-fg font-mono outline-none focus:border-cyan"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Physical Terminal Screen & Action */}
        <div className="lg:col-span-6 flex flex-col justify-between bg-[#050608] border border-white/10 rounded-2xl p-4 shadow-inner">
          {/* LCD Screen Display */}
          <div className="bg-[#0b100d] border border-emerald/20 rounded-xl p-3 font-mono text-xs text-emerald space-y-1.5 shadow-inner">
            <div className="flex justify-between border-b border-emerald/20 pb-1 text-[11px] text-emerald/80">
              <span>ORVENT-POS v2.4</span>
              <span>VISA APPR</span>
            </div>
            <div className="text-center py-2">
              <div className="text-muted/80 text-[10px]">MERCHANT: {selectedMerchant === "Custom" ? customMerchant || "Retail" : selectedMerchant}</div>
              <div className="text-2xl font-bold text-fg tracking-tight my-1">
                ${parseFloat(customAmount || "0").toFixed(2)}
              </div>
              <div className="text-[11px] text-emerald font-semibold">
                {isProcessing
                  ? "PROCESSING..."
                  : terminalMessage || "READY FOR TAP / INSERT"}
              </div>
            </div>
            <div className="flex justify-between border-t border-emerald/20 pt-1 text-[10px] text-emerald/60">
              <span>Card: •••• 7412</span>
              <span>{isCardFrozen ? "FROZEN" : "UNLOCKED"}</span>
            </div>
          </div>

          {/* Swipe Trigger */}
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={handleSwipeSubmit}
              disabled={isProcessing}
              className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                isProcessing
                  ? "bg-surface-2 text-muted cursor-wait"
                  : isCardFrozen
                  ? "bg-danger/20 border border-danger/40 text-danger hover:bg-danger/30"
                  : "bg-cyan text-bg hover:brightness-110 shadow-lg shadow-cyan/20 cursor-pointer"
              }`}
            >
              {isProcessing ? (
                <>
                  <span className="h-3 w-3 rounded-full border-2 border-muted border-t-transparent animate-spin" />
                  Verifying Invariants...
                </>
              ) : (
                <>
                  <span>💳</span>
                  Tap / Swipe Card to Pay ${parseFloat(customAmount || "0").toFixed(2)}
                </>
              )}
            </button>
            <div className="flex justify-between text-[11px] font-mono text-muted/70 px-1">
              <span>Capacity: ${(availableLimit + microBuffer).toFixed(2)}</span>
              <span>Fee: $0.00 (Gasless)</span>
            </div>
          </div>

          {/* Printed Receipt Output */}
          {lastReceipt && (
            <div className="mt-4 bg-surface-2/90 border border-white/10 rounded-xl p-3 font-mono text-xs text-muted space-y-1 animate-in slide-in-from-bottom-2">
              <div className="flex justify-between text-fg font-bold border-b border-white/5 pb-1">
                <span>RECEIPT #{lastReceipt.authCode}</span>
                <span className="text-emerald">APPROVED</span>
              </div>
              <div className="flex justify-between">
                <span>Merchant:</span>
                <span className="text-fg">{lastReceipt.merchant}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount:</span>
                <span className="text-fg font-bold">${lastReceipt.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Time:</span>
                <span>{lastReceipt.timestamp}</span>
              </div>
              <div className="flex justify-between">
                <span>Tx Hash:</span>
                <span className="text-cyan">{lastReceipt.txHash}</span>
              </div>
              <div className="pt-1 text-[10px] text-emerald/80 border-t border-white/5">
                ✓ Principal 100% Intact • Health Factor: {lastReceipt.postHf.toFixed(2)}x
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
