"use client";

import { useState } from "react";
import { TIME_SCALES, type TimeScale } from "@/features/vault/useVaultState";

interface VaultOverviewProps {
  principalUsd: number;
  apyPercent: number;
  accruedYieldUsd: number;
  /** Earned yield you can spend right now. */
  spendableUsd: number;
  timeScale: TimeScale;
  onTimeScale: (s: TimeScale) => void;
  onDeposit: (amount: number) => { success: boolean; error?: string };
  onWithdraw: (amount: number) => { success: boolean; error?: string };
}

const usd = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/** The Playground vault: the same three cards and safety panel as the Mainnet dashboard, fed by a simulation. */
export function VaultOverview({ principalUsd, apyPercent, accruedYieldUsd, spendableUsd, timeScale, onTimeScale, onDeposit, onWithdraw }: VaultOverviewProps) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeModal, setActiveModal] = useState<"deposit" | "withdraw" | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const open = (m: "deposit" | "withdraw") => {
    setActiveModal(m);
    setModalError(null);
  };
  const close = () => setActiveModal(null);

  const submitDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(depositAmount);
    if (isNaN(val) || val <= 0) return setModalError("Please enter a valid amount");
    const res = onDeposit(val);
    if (!res.success) return setModalError(res.error ?? "Deposit failed");
    setDepositAmount("");
    close();
  };

  const submitWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(withdrawAmount);
    if (isNaN(val) || val <= 0) return setModalError("Please enter a valid amount");
    const res = onWithdraw(val);
    if (!res.success) return setModalError(res.error ?? "Withdrawal failed");
    setWithdrawAmount("");
    close();
  };

  return (
    <div className="space-y-6">
      {/* 3 main stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Card 1: Principal vault */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Principal Vault</span>
            <div className="flex items-center gap-1.5 rounded-full border border-emerald/20 bg-emerald/10 px-2 py-0.5 text-xs font-medium text-emerald">
              <span>+{apyPercent}% APY</span>
            </div>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <span data-testid="principal-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">${usd(principalUsd)}</span>
          </div>
          <div className="mb-4 font-mono text-xs text-muted">Locked in your playground vault · USDC</div>
          <div className="flex items-center gap-2">
            <button data-testid="open-deposit" onClick={() => open("deposit")} className="min-h-11 flex-1 rounded-xl bg-cyan py-2 text-center text-xs font-semibold text-bg shadow-sm shadow-cyan/30 transition-all hover:brightness-110">
              + Deposit USDC
            </button>
            <button data-testid="open-withdraw" onClick={() => open("withdraw")} className="min-h-11 flex-1 rounded-xl border border-white/10 bg-surface-2 py-2 text-center text-xs font-semibold text-fg transition-all hover:bg-white/5">
              Withdraw
            </button>
          </div>
        </div>

        {/* Card 2: Live accrued yield */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Live Accrued Yield</span>
            <span className="flex items-center gap-1.5 font-mono text-xs text-emerald">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald" />
              Accruing
            </span>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <span data-testid="yield-value" className="text-3xl font-extrabold tracking-tight text-emerald tabular">${accruedYieldUsd.toFixed(4)}</span>
          </div>
          <div className="mb-4 font-mono text-xs text-muted">Accrues continuously from your principal at the demo APY</div>
          <div className="flex items-center justify-between font-mono text-[11px] text-muted">
            <span id="speed-label">Demo speed</span>
            <div role="group" aria-labelledby="speed-label" className="flex gap-1">
              {TIME_SCALES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`speed-${t}`}
                  aria-pressed={timeScale === t}
                  onClick={() => onTimeScale(t)}
                  className={`rounded-md border px-2 py-0.5 ${timeScale === t ? "border-cyan/50 bg-cyan/15 text-cyan" : "border-white/10 text-muted hover:text-fg"}`}
                >
                  {t.toLocaleString()}×
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Card 3: Available spend limit */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Available Spend Limit</span>
            <span className="font-mono text-xs font-medium text-cyan">100% yield-backed</span>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <span data-testid="limit-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">${usd(spendableUsd)}</span>
          </div>
          <div className="mb-4 flex items-center justify-between font-mono text-xs text-muted">
            <span>Borrowed: $0.00</span>
            <span className="text-cyan/80">Principal used: $0.00</span>
          </div>
          <div className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-surface-2 px-3 py-1.5 font-mono text-xs">
            <span className="text-muted">Spendable now:</span>
            <span className="font-semibold text-cyan">${usd(spendableUsd)}</span>
          </div>
        </div>
      </div>

      {/* Principal safety */}
      <div className="rounded-2xl border border-white/5 bg-surface p-5">
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
              Principal Safety
              <span data-testid="safety-status" className="rounded-full border border-emerald/30 bg-emerald/10 px-2.5 py-0.5 font-mono text-xs font-medium text-emerald">Safe</span>
            </h3>
            <p className="mt-0.5 text-xs text-muted">Rule: only earned yield can be spent. Nothing is borrowed, so there is no health factor and nothing to liquidate.</p>
          </div>
          <span data-testid="safety-value" className="font-mono text-2xl font-black text-fg tabular">No debt</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-white/5 bg-surface-2">
            <div className="h-full w-full bg-emerald transition-all duration-500" />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-muted/70">
            <span>Principal locked</span>
            <span>Yield spendable</span>
            <span>Withdraw any time</span>
          </div>
        </div>
      </div>

      {/* Modal: Deposit */}
      {activeModal === "deposit" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-fg">Deposit USDC</h3>
              <button onClick={close} aria-label="Close" className="grid h-11 w-11 place-items-center text-sm text-muted hover:text-fg">✕</button>
            </div>
            <p className="mb-4 text-xs text-muted">Add USDC to your playground vault. No tokens move.</p>
            <form onSubmit={submitDeposit} className="space-y-4">
              <div>
                <label htmlFor="pg-deposit" className="mb-1 block font-mono text-xs text-muted">Amount in USDC</label>
                <div className="relative">
                  <input id="pg-deposit" data-testid="deposit-input" type="number" step="0.01" placeholder="0.00" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 font-mono text-lg text-fg outline-none focus:border-cyan" />
                  <div className="absolute right-3 top-3 flex items-center gap-2">
                    <button type="button" onClick={() => setDepositAmount("100")} className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted hover:text-fg">+100</button>
                    <button type="button" onClick={() => setDepositAmount("1000")} className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted hover:text-fg">+1,000</button>
                  </div>
                </div>
              </div>
              {depositAmount && !isNaN(parseFloat(depositAmount)) && (
                <div className="space-y-1 rounded-xl bg-surface-2 p-3 font-mono text-xs text-muted">
                  <div className="flex justify-between">
                    <span>Est. yearly yield ({apyPercent}%):</span>
                    <span className="font-semibold text-emerald">+${((parseFloat(depositAmount) * apyPercent) / 100).toFixed(2)}/yr</span>
                  </div>
                </div>
              )}
              {modalError && <p className="font-mono text-xs text-danger">{modalError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={close} className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-muted hover:text-fg">Cancel</button>
                <button type="submit" data-testid="deposit-confirm" className="flex-1 rounded-xl bg-cyan py-2.5 text-xs font-semibold text-bg shadow-sm shadow-cyan/30 hover:brightness-110">Confirm Deposit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Withdraw */}
      {activeModal === "withdraw" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-fg">Withdraw principal</h3>
              <button onClick={close} aria-label="Close" className="grid h-11 w-11 place-items-center text-sm text-muted hover:text-fg">✕</button>
            </div>
            <p className="mb-4 text-xs text-muted">Take USDC out of your playground vault. It stops earning yield on that amount.</p>
            <form onSubmit={submitWithdraw} className="space-y-4">
              <div>
                <div className="mb-1 flex justify-between font-mono text-xs text-muted">
                  <label htmlFor="pg-withdraw">Amount in USDC</label>
                  <span>Balance: {usd(principalUsd)}</span>
                </div>
                <div className="relative">
                  <input id="pg-withdraw" data-testid="withdraw-input" type="number" step="0.01" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 font-mono text-lg text-fg outline-none focus:border-cyan" />
                  <button type="button" onClick={() => setWithdrawAmount(principalUsd.toString())} className="absolute right-3 top-3 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-cyan hover:text-white">MAX</button>
                </div>
              </div>
              {modalError && (
                <div role="alert" data-testid="modal-error" className="rounded-xl border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">{modalError}</div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={close} className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-muted hover:text-fg">Cancel</button>
                <button type="submit" data-testid="withdraw-confirm" className="flex-1 rounded-xl bg-cyan py-2.5 text-xs font-semibold text-bg shadow-sm shadow-cyan/30 hover:brightness-110">Confirm Withdrawal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
