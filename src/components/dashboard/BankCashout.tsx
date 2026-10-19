"use client";

import { useState } from "react";
import { RAILS, validateDestination, type Rail } from "@/utils/payments";

interface BankCashoutProps {
  accruedYieldUsd: number;
  availableLimit: number;
  onCashout: (
    amountUsd: number,
    rail: Rail["id"],
    destination: string,
    allowCredit: boolean
  ) => { success: boolean; error?: string };
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function BankCashout({ accruedYieldUsd, availableLimit, onCashout }: BankCashoutProps) {
  const [rail, setRail] = useState<Rail>(RAILS[0]!);
  const [amountUsd, setAmountUsd] = useState("50");
  const [destination, setDestination] = useState("");
  const [allowCredit, setAllowCredit] = useState(false);
  const [touched, setTouched] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const amount = parseFloat(amountUsd);
  const amountValid = Number.isFinite(amount) && amount > 0;
  const fiat = amountValid ? amount * rail.rate : 0;
  const fromYield = amountValid ? Math.min(amount, accruedYieldUsd) : 0;
  const fromCredit = amountValid ? Math.max(0, amount - fromYield) : 0;
  const destCheck = destination.trim() ? validateDestination(rail.id, destination) : null;
  const destError = touched && destCheck && !destCheck.ok ? destCheck.error : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setErrorMsg(null);
    setSuccess(null);
    if (!amountValid) return setErrorMsg("Enter an amount greater than $0.");
    if (!destination.trim()) return setErrorMsg(`Enter your ${rail.id === "upi" ? "UPI ID" : rail.id === "sepa" ? "IBAN" : "routing and account number"}.`);
    // Invalid destinations are reported inline under the field only (no duplicate banner).
    if (!validateDestination(rail.id, destination).ok) return;
    const res = onCashout(amount, rail.id, destination, allowCredit);
    if (!res.success) return setErrorMsg(res.error ?? "Cashout failed.");
    setSuccess(`Payout of ${fiat.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${rail.currency} queued via ${rail.name}. Playground payout: no real money moved.`);
    setDestination("");
    setTouched(false);
  };

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-5">
      <div>
        <h3 className="text-base font-bold text-fg flex flex-wrap items-center gap-2">
          1-Click Bank &amp; UPI Cashout
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/20 text-cyan font-mono">
            playground
          </span>
        </h3>
        <p className="text-xs text-muted mt-0.5">
          Pay out accrued yield to a bank account without selling your collateral.
        </p>
      </div>

      {success && (
        <div role="status" data-testid="cashout-success" className="bg-emerald/10 border border-emerald/30 text-emerald text-xs rounded-xl p-3.5">
          {success}
        </div>
      )}
      {errorMsg && (
        <div role="alert" data-testid="cashout-error" className="bg-danger/10 border border-danger/30 text-danger text-xs font-mono p-3 rounded-xl">
          {errorMsg}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="text-xs font-mono text-muted mb-1.5">Payout rail</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {RAILS.map((r) => {
              const active = rail.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  data-testid={`rail-${r.id}`}
                  aria-pressed={active}
                  onClick={() => {
                    setRail(r);
                    setErrorMsg(null);
                    setTouched(false);
                  }}
                  className={`p-3 rounded-xl border text-left text-xs transition-all ${
                    active ? "bg-cyan/10 border-cyan/40 text-fg shadow-sm shadow-cyan/20" : "bg-surface-2 border-white/5 text-muted hover:text-fg"
                  }`}
                >
                  <div className="font-bold">{r.name}</div>
                  <div className="text-[11px] font-mono text-cyan mt-1">1 USD = {r.rate} {r.currency}</div>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="cashout-amount" className="flex justify-between text-xs font-mono text-muted mb-1">
              <span>Amount (USD)</span>
              <span>Yield {money(accruedYieldUsd)} · Credit {money(availableLimit)}</span>
            </label>
            <input
              id="cashout-amount"
              data-testid="cashout-amount"
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono text-fg outline-none focus:border-cyan"
            />
          </div>
          <div>
            <label htmlFor="cashout-dest" className="block text-xs font-mono text-muted mb-1">
              {rail.id === "upi" ? "UPI ID" : rail.id === "sepa" ? "IBAN" : "Routing / account"} ({rail.currency})
            </label>
            <input
              id="cashout-dest"
              data-testid="cashout-dest"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={rail.placeholder}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={destError ? true : undefined}
              aria-describedby={destError ? "cashout-dest-err" : undefined}
              className={`w-full bg-surface-2 border rounded-xl px-3.5 py-2.5 text-sm font-mono text-fg outline-none focus:border-cyan ${
                destError ? "border-danger/60" : "border-white/10"
              }`}
            />
            {destError && (
              <p id="cashout-dest-err" className="mt-1 text-[11px] text-danger font-mono">{destError}</p>
            )}
            {touched && destCheck?.ok && <p className="mt-1 text-[11px] text-emerald font-mono">Looks valid</p>}
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
          <input
            type="checkbox"
            data-testid="allow-credit"
            checked={allowCredit}
            onChange={(e) => setAllowCredit(e.target.checked)}
            className="mt-0.5 accent-cyan"
          />
          <span>
            Allow a credit advance if my yield is not enough{" "}
            <span className="text-muted/60">(borrows against collateral; HF must stay ≥ 1.20x)</span>
          </span>
        </label>

        <div className="bg-[#090b10] border border-white/5 rounded-xl p-3 text-xs font-mono text-muted space-y-1">
          <div className="flex justify-between">
            <span>Recipient gets</span>
            <span className="text-emerald font-bold">
              {fiat.toLocaleString(undefined, { maximumFractionDigits: 2 })} {rail.currency}
            </span>
          </div>
          <div className="flex justify-between text-[11px]"><span>From accrued yield</span><span>{money(fromYield)}</span></div>
          <div className="flex justify-between text-[11px]">
            <span>From credit advance</span>
            <span className={fromCredit > 0 && !allowCredit ? "text-danger" : ""}>{money(fromCredit)}</span>
          </div>
        </div>

        <button
          type="submit"
          data-testid="cashout-submit"
          className="w-full py-3 rounded-xl bg-cyan text-bg font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg shadow-cyan/25 transition-all"
        >
          Confirm cashout ({fiat.toLocaleString(undefined, { maximumFractionDigits: 2 })} {rail.currency})
        </button>
      </form>
    </div>
  );
}
