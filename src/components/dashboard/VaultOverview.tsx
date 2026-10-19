"use client";

import { useState } from "react";
import { SUPPORTED_TOKENS, TIME_SCALES, type TimeScale, type TokenOption } from "@/features/vault/useVaultState";
import { type HealthStatus } from "@/utils/math";

interface VaultOverviewProps {
  selectedToken: TokenOption;
  onSelectToken: (token: TokenOption) => void;
  collateralAmount: number;
  collateralUsd: number;
  activeDebtUsd: number;
  accruedYieldUsd: number;
  availableLimit: number;
  healthFactor: number;
  healthStatus: HealthStatus;
  microBuffer: number;
  advanceUsd: number;
  advanceRoom: number;
  timeScale: TimeScale;
  onTimeScale: (s: TimeScale) => void;
  onDeposit: (amount: number) => { success: boolean; error?: string };
  onWithdraw: (amount: number) => { success: boolean; error?: string };
  onRepayWithYield: () => { success: boolean; repaidAmount: number };
}

export function VaultOverview({
  selectedToken,
  onSelectToken,
  collateralAmount,
  collateralUsd,
  activeDebtUsd,
  accruedYieldUsd,
  availableLimit,
  healthFactor,
  healthStatus,
  microBuffer,
  advanceUsd,
  advanceRoom,
  timeScale,
  onTimeScale,
  onDeposit,
  onWithdraw,
  onRepayWithYield,
}: VaultOverviewProps) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeModal, setActiveModal] = useState<"deposit" | "withdraw" | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [repayNotification, setRepayNotification] = useState<string | null>(null);

  const handleDepositSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(depositAmount);
    if (isNaN(val) || val <= 0) {
      setModalError("Please enter a valid amount");
      return;
    }
    const res = onDeposit(val);
    if (!res.success) {
      setModalError(res.error ?? "Deposit failed");
      return;
    }
    setDepositAmount("");
    setActiveModal(null);
    setModalError(null);
  };

  const handleWithdrawSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(withdrawAmount);
    if (isNaN(val) || val <= 0) {
      setModalError("Please enter a valid amount");
      return;
    }
    const result = onWithdraw(val);
    if (!result.success) {
      setModalError(result.error || "Withdrawal failed");
      return;
    }
    setWithdrawAmount("");
    setActiveModal(null);
    setModalError(null);
  };

  const handleRepayClick = () => {
    const res = onRepayWithYield();
    if (res.success) {
      setRepayNotification(`Successfully settled $${res.repaidAmount.toFixed(2)} of debt using accrued yield!`);
      setTimeout(() => setRepayNotification(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Repay alert banner */}
      {repayNotification && (
        <div className="bg-emerald/10 border border-emerald/30 text-emerald text-sm rounded-xl px-4 py-3 flex items-center justify-between ">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald animate-ping" />
            <span>{repayNotification}</span>
          </div>
          <button
            onClick={() => setRepayNotification(null)}
            className="text-xs text-muted hover:text-fg"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3 Main Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Collateral Vault */}
        <div className="bg-surface border border-white/5 rounded-2xl p-5 relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">
              Collateral Vault
            </span>
            <div className="flex items-center gap-1.5 bg-emerald/10 border border-emerald/20 text-emerald text-xs px-2 py-0.5 rounded-full font-medium">
              <span>+{selectedToken.apyPercent}% APY</span>
            </div>
          </div>

          <div className="flex items-baseline gap-2 mb-1">
            <span data-testid="collateral-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">
              ${collateralUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-xs text-muted font-mono mb-4">
            Held: {collateralAmount.toFixed(4)} {selectedToken.symbol} @ ${selectedToken.priceUsd.toLocaleString()}
          </div>

          {/* Asset Selector & Vault Buttons */}
          <div className="flex items-center gap-2">
            <button
              data-testid="open-deposit"
              onClick={() => {
                setActiveModal("deposit");
                setModalError(null);
              }}
              className="flex-1 text-xs font-semibold py-2 rounded-xl bg-cyan text-bg hover:brightness-110 transition-all text-center shadow-sm shadow-cyan/30"
            >
              + Deposit
            </button>
            <button
              data-testid="open-withdraw"
              onClick={() => {
                setActiveModal("withdraw");
                setModalError(null);
              }}
              className="flex-1 text-xs font-semibold py-2 rounded-xl bg-surface-2 border border-white/10 text-fg hover:bg-white/5 transition-all text-center"
            >
              Withdraw
            </button>
            <select
              aria-label="Collateral asset"
              data-testid="asset-select"
              value={selectedToken.symbol}
              onChange={(e) => {
                const key = e.target.value as keyof typeof SUPPORTED_TOKENS;
                const token = SUPPORTED_TOKENS[key];
                if (token) onSelectToken(token);
              }}
              className="text-xs bg-surface-2 border border-white/10 rounded-xl px-2 py-2 text-muted font-mono outline-none cursor-pointer"
            >
              <option value="weETH">weETH</option>
              <option value="USDC">USDC</option>
              <option value="WETH">WETH</option>
            </select>
          </div>
        </div>

        {/* Card 2: Live Accruing Yield */}
        <div className="bg-surface border border-white/5 rounded-2xl p-5 relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">
              Live Accrued Yield
            </span>
            <span className="flex items-center gap-1.5 text-xs text-emerald font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald animate-pulse" />
              Accruing
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-1">
            <span data-testid="yield-value" className="text-3xl font-extrabold tracking-tight text-emerald tabular">
              ${accruedYieldUsd.toFixed(6)}
            </span>
          </div>
          <div className="text-xs text-muted font-mono mb-4">
            Accrues continuously from your collateral at the blended APY
          </div>

          <div className="mb-3 flex items-center justify-between text-[11px] font-mono text-muted">
            <span id="speed-label">Demo speed</span>
            <div role="group" aria-labelledby="speed-label" className="flex gap-1">
              {TIME_SCALES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`speed-${t}`}
                  aria-pressed={timeScale === t}
                  onClick={() => onTimeScale(t)}
                  className={`rounded-md border px-2 py-0.5 ${
                    timeScale === t ? "border-cyan/50 bg-cyan/15 text-cyan" : "border-white/10 text-muted hover:text-fg"
                  }`}
                >
                  {t.toLocaleString()}×
                </button>
              ))}
            </div>
          </div>

          <button
            data-testid="autopilot-repay"
            onClick={handleRepayClick}
            disabled={activeDebtUsd <= 0 || accruedYieldUsd <= 0}
            className={`w-full text-xs font-semibold py-2 rounded-xl border transition-all text-center ${
              activeDebtUsd > 0 && accruedYieldUsd > 0
                ? "bg-emerald/10 border-emerald/30 text-emerald hover:bg-emerald/20 cursor-pointer shadow-sm shadow-emerald/20"
                : "bg-surface-2 border-white/5 text-muted/50 cursor-not-allowed"
            }`}
          >
            {activeDebtUsd > 0
              ? `Auto-Pilot: repay debt with yield ($${Math.min(activeDebtUsd, accruedYieldUsd).toFixed(2)})`
              : "No Active Debt to Repay"}
          </button>
        </div>

        {/* Card 3: Available Spending Capacity */}
        <div className="bg-surface border border-white/5 rounded-2xl p-5 relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">
              Available Spend Limit
            </span>
            <span className="text-xs text-cyan font-mono font-medium">
              {(selectedToken.maxLtv * 100).toFixed(0)}% Max LTV
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-1">
            <span data-testid="limit-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">
              ${availableLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-xs text-muted font-mono mb-4 flex items-center justify-between">
            <span data-testid="debt-value">Active Debt: ${activeDebtUsd.toFixed(2)}</span>
            <span className="text-cyan/80">Advance: ${advanceUsd.toFixed(2)}</span>
          </div>

          <div className="w-full bg-surface-2 border border-white/5 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs font-mono">
            <span className="text-muted">7-Day Micro-Buffer:</span>
            <span className="text-cyan font-semibold">${advanceRoom.toFixed(2)} of ${microBuffer.toFixed(2)} free</span>
          </div>
        </div>
      </div>

      {/* Health Factor & Risk Monitor */}
      <div className="bg-surface border border-white/5 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
              Collateral Health Factor
              <span className={`text-xs px-2.5 py-0.5 rounded-full border font-mono font-medium ${healthStatus.colorClass}`}>
                {healthStatus.label}
              </span>
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Rule: a spend, voucher or payout that would leave Health Factor below 1.20x is declined.
            </p>
          </div>
          <div className="flex items-baseline gap-2">
            <span data-testid="hf-value" className="text-2xl font-black font-mono text-fg tabular">
              {healthFactor >= 999 ? "∞ Safe" : `${healthFactor.toFixed(2)}x`}
            </span>
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="space-y-1.5">
          <div className="h-2.5 w-full bg-surface-2 rounded-full overflow-hidden flex border border-white/5">
            <div
              className={`h-full transition-all duration-500 ${
                healthFactor >= 1.5
                  ? "bg-emerald"
                  : healthFactor >= 1.2
                  ? "bg-amber"
                  : "bg-danger"
              }`}
              style={{
                width: `${Math.min(100, Math.max(5, (healthFactor / 3.0) * 100))}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-muted/70">
            <span>1.0x (Liquidation)</span>
            <span>1.2x (Warning)</span>
            <span>1.5x+ (Safe Zone)</span>
            <span>3.0x+</span>
          </div>
        </div>
      </div>

      {/* Modal: Deposit */}
      {activeModal === "deposit" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-surface border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-fg">Deposit Collateral</h3>
              <button
                onClick={() => setActiveModal(null)}
                className="text-muted hover:text-fg text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted mb-4">
              Add {selectedToken.name} to your playground vault. No tokens move.
            </p>

            <form onSubmit={handleDepositSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-mono text-muted block mb-1">
                  Amount in {selectedToken.symbol}
                </label>
                <div className="relative">
                  <input
                    data-testid="deposit-input"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full bg-surface-2 border border-white/10 rounded-xl px-4 py-3 text-fg font-mono text-lg outline-none focus:border-cyan"
                  />
                  <div className="absolute right-3 top-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositAmount("1.0")}
                      className="text-[11px] bg-white/5 border border-white/10 px-2 py-0.5 rounded text-muted hover:text-fg"
                    >
                      +1.0
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositAmount("5.0")}
                      className="text-[11px] bg-white/5 border border-white/10 px-2 py-0.5 rounded text-muted hover:text-fg"
                    >
                      +5.0
                    </button>
                  </div>
                </div>
              </div>

              {depositAmount && !isNaN(parseFloat(depositAmount)) && (
                <div className="bg-surface-2 rounded-xl p-3 text-xs font-mono text-muted space-y-1">
                  <div className="flex justify-between">
                    <span>USD Equivalent:</span>
                    <span className="text-fg font-semibold">
                      ${(parseFloat(depositAmount) * selectedToken.priceUsd).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Est. Yearly Yield ({selectedToken.apyPercent}%):</span>
                    <span className="text-emerald font-semibold">
                      +${(parseFloat(depositAmount) * selectedToken.priceUsd * (selectedToken.apyPercent / 100)).toFixed(2)}/yr
                    </span>
                  </div>
                </div>
              )}

              {modalError && (
                <p className="text-xs text-danger font-mono">{modalError}</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-muted hover:text-fg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="deposit-confirm"
                  className="flex-1 py-2.5 rounded-xl bg-cyan text-bg text-xs font-semibold hover:brightness-110 shadow-sm shadow-cyan/30"
                >
                  Confirm Deposit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Withdraw */}
      {activeModal === "withdraw" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-surface border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-fg">Withdraw Collateral</h3>
              <button
                onClick={() => setActiveModal(null)}
                className="text-muted hover:text-fg text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted mb-4">
              Withdraw {selectedToken.symbol} from your playground vault. With active debt, Health Factor must stay at or above 1.20x.
            </p>

            <form onSubmit={handleWithdrawSubmit} className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-mono text-muted mb-1">
                  <span>Amount in {selectedToken.symbol}</span>
                  <span>Balance: {collateralAmount.toFixed(4)}</span>
                </div>
                <div className="relative">
                  <input
                    data-testid="withdraw-input"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full bg-surface-2 border border-white/10 rounded-xl px-4 py-3 text-fg font-mono text-lg outline-none focus:border-cyan"
                  />
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(collateralAmount.toString())}
                    className="absolute right-3 top-3 text-[11px] bg-white/5 border border-white/10 px-2 py-0.5 rounded text-cyan hover:text-white"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {modalError && (
                <div role="alert" data-testid="modal-error" className="bg-danger/10 border border-danger/30 rounded-xl p-3 text-xs text-danger font-mono">
                  {modalError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-muted hover:text-fg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="withdraw-confirm"
                  className="flex-1 py-2.5 rounded-xl bg-cyan text-bg text-xs font-semibold hover:brightness-110 shadow-sm shadow-cyan/30"
                >
                  Confirm Withdrawal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
