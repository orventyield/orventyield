"use client";

import { useState } from "react";

interface BankCashoutProps {
  accruedYieldUsd: number;
  availableLimit: number;
  onCashout: (
    amountUsd: number,
    rail: string,
    identifier: string
  ) => { success: boolean; error?: string };
}

interface RailOption {
  id: string;
  name: string;
  currency: string;
  rate: number;
  placeholder: string;
}

const RAILS: RailOption[] = [
  { id: "upi", name: "UPI Instant (India)", currency: "INR", rate: 84.5, placeholder: "e.g. yourname@oksbi" },
  { id: "sepa", name: "SEPA Instant (EU / UK)", currency: "EUR", rate: 0.92, placeholder: "e.g. DE89 3704 0044 0532 0130 00" },
  { id: "ach", name: "ACH Direct (US)", currency: "USD", rate: 1.0, placeholder: "e.g. Routing + Account number" },
];

export function BankCashout({
  accruedYieldUsd,
  availableLimit,
  onCashout,
}: BankCashoutProps) {
  const [selectedRail, setSelectedRail] = useState<RailOption>(RAILS[0]!);
  const [amountUsd, setAmountUsd] = useState("50");
  const [identifier, setIdentifier] = useState("");
  const [cashoutSuccess, setCashoutSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsedAmount = parseFloat(amountUsd) || 0;
  const fiatEquivalent = parsedAmount * selectedRail.rate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setCashoutSuccess(null);

    if (parsedAmount <= 0) {
      setErrorMsg("Please enter a valid amount");
      return;
    }
    if (!identifier.trim()) {
      setErrorMsg("Please provide your account or UPI ID");
      return;
    }

    const res = onCashout(parsedAmount, selectedRail.name, identifier.trim());
    if (!res.success) {
      setErrorMsg(res.error || "Cashout failed");
    } else {
      setCashoutSuccess(
        `Sent ${fiatEquivalent.toLocaleString()} ${selectedRail.currency} to ${identifier.trim()} via ${selectedRail.name}!`
      );
      setIdentifier("");
      setTimeout(() => setCashoutSuccess(null), 6000);
    }
  };

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-5">
      <div>
        <h3 className="text-base font-bold text-fg flex items-center gap-2">
          1-Click Bank & UPI Cashout
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/20 text-cyan font-mono">
            Zero-Fee Off-Ramp
          </span>
        </h3>
        <p className="text-xs text-muted mt-0.5">
          Send accrued yield directly to your local bank or UPI without selling your collateral.
        </p>
      </div>

      {cashoutSuccess && (
        <div className="bg-emerald/10 border border-emerald/30 text-emerald text-xs rounded-xl p-3.5 flex items-center gap-2 animate-in fade-in">
          <span className="h-2 w-2 rounded-full bg-emerald animate-ping" />
          <span>{cashoutSuccess}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-xs font-mono p-3 rounded-xl">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Rail Selection */}
        <div>
          <label className="text-xs font-mono text-muted block mb-1.5">
            Select Destination Banking Rail
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {RAILS.map((r) => {
              const active = selectedRail.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedRail(r);
                    setErrorMsg(null);
                  }}
                  className={`p-3 rounded-xl border text-left text-xs transition-all ${
                    active
                      ? "bg-cyan/10 border-cyan/40 text-fg shadow-sm shadow-cyan/20"
                      : "bg-surface-2 border-white/5 text-muted hover:text-fg"
                  }`}
                >
                  <div className="font-bold">{r.name}</div>
                  <div className="text-[11px] font-mono text-cyan mt-1">
                    1 USD = {r.rate} {r.currency}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount & Account Input */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between text-xs font-mono text-muted mb-1">
              <span>Amount (USD)</span>
              <span>Yield: ${accruedYieldUsd.toFixed(2)} | Credit: ${availableLimit.toFixed(2)}</span>
            </div>
            <input
              type="number"
              step="1"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono text-fg outline-none focus:border-cyan"
            />
          </div>

          <div>
            <div className="text-xs font-mono text-muted mb-1">
              Destination ({selectedRail.currency})
            </div>
            <input
              type="text"
              placeholder={selectedRail.placeholder}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono text-fg outline-none focus:border-cyan"
            />
          </div>
        </div>

        {/* Conversion breakdown */}
        <div className="bg-[#090b10] border border-white/5 rounded-xl p-3 text-xs font-mono text-muted space-y-1">
          <div className="flex justify-between">
            <span>You Receive:</span>
            <span className="text-emerald font-bold">
              {fiatEquivalent.toLocaleString()} {selectedRail.currency}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span>Funding Priority:</span>
            <span>Accrued Yield First, then Credit Line</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span>Network Fee:</span>
            <span className="text-emerald font-bold">Free ($0.00)</span>
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-3 rounded-xl bg-cyan text-bg font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg shadow-cyan/25 transition-all"
        >
          Confirm 1-Click Cashout ({fiatEquivalent.toLocaleString()} {selectedRail.currency})
        </button>
      </form>
    </div>
  );
}
