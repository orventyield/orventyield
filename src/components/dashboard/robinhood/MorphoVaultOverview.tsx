"use client";

import { useEffect, useState } from "react";
import { LiveYield } from "@/components/ui/LiveYield";
import type { useMorphoAccount } from "@/features/account/useMorphoAccount";
import { fmtUsdc, fmtUsdc4 } from "@/lib/aave/format";
import { ROBINHOOD_EXPLORER } from "@/lib/contracts/robinhood";
import { tickYield } from "@/lib/morpho/apy";

type Account = ReturnType<typeof useMorphoAccount>;
export type MorphoModal = "deposit" | "bridge" | "yield" | "principal" | null;

/** The Robinhood Chain twin of the Arbitrum vault overview: Safe + Morpho "Steakhouse USDG", all figures in USDG. */
export function MorphoVaultOverview({ m, apy, onOpen }: { m: Account; apy: number | null; onOpen: (x: MorphoModal) => void }) {
  const snap = m.snapshot;
  const principal = snap?.principal ?? 0n;
  const assets = snap?.aBalance ?? 0n;
  const hasPosition = assets > 0n;

  // Display-only: the yield read from the vault, plus what the position earns each second at the vault's APY.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ticking = tickYield(snap?.yieldAvailable ?? 0n, assets, apy, m.fetchedAt ? now - m.fetchedAt : 0);
  const explorer = m.onFork ? undefined : ROBINHOOD_EXPLORER;
  const limit = ticking > 0n ? ticking : 0n;

  return (
    <div className="space-y-6" data-testid="vault-overview">
      {m.gasWarning && (
        <div role="alert" data-testid="no-gas" className="rounded-xl border border-amber/30 bg-amber/10 p-3 text-sm text-amber">
          {m.gasWarning}
        </div>
      )}

      {/* 3 main stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Card 1: Principal vault */}
        <div className="group relative overflow-hidden rounded-2xl glass-card p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Principal Vault</span>
            <div className="flex items-center gap-1.5 rounded-full border border-emerald/20 bg-emerald/10 px-2 py-0.5 text-xs font-medium text-emerald">
              <span data-testid="apy-value">{apy === null ? "Variable APY" : `+${(apy * 100).toFixed(2)}% APY`}</span>
            </div>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <span data-testid="principal-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">${fmtUsdc(principal)}</span>
            <span className="font-mono text-sm font-semibold text-emerald">USDG</span>
          </div>
          <div className="mb-4 font-mono text-xs text-muted">In the Morpho vault via your Safe · USDG</div>
          <div className="flex items-center gap-2">
            <button type="button" data-testid="open-deposit" onClick={() => onOpen("deposit")} className="min-h-11 flex-1 rounded-xl bg-cyan py-2 text-center text-xs font-semibold text-bg shadow-sm shadow-cyan/30 transition-all hover:brightness-110">
              + Deposit USDG
            </button>
            <button type="button" data-testid="open-bridge" onClick={() => onOpen("bridge")} className="min-h-11 flex-1 rounded-xl border border-cyan/30 bg-cyan/10 py-2 text-center text-xs font-semibold text-cyan transition-all hover:bg-cyan/20">
              Bridge &amp; Deposit
            </button>
            <button type="button" data-testid="open-principal" disabled={principal <= 0n} onClick={() => onOpen("principal")} className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.05] py-2 text-center text-xs font-semibold text-fg transition-all hover:bg-white/5 disabled:opacity-40">
              Withdraw
            </button>
          </div>
        </div>

        {/* Card 2: Live accrued yield */}
        <div className="group relative overflow-hidden rounded-2xl glass-card p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Live Accrued Yield</span>
            <span className="flex items-center gap-1.5 font-mono text-xs text-emerald">
              <span className={`h-2 w-2 rounded-full bg-emerald ${hasPosition ? "tick-dot" : "opacity-40"}`} />
              {hasPosition ? "Accruing" : "Waiting for a deposit"}
            </span>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <LiveYield testId="yield-value" value={`$${fmtUsdc4(ticking)}`} live={hasPosition} />
            <span className="font-mono text-sm font-semibold text-emerald">USDG</span>
          </div>
          <div className="mb-4 font-mono text-xs text-muted">Read from Morpho vault. Variable, not guaranteed.</div>
          <button type="button" data-testid="open-yield" disabled={m.limits.yield <= 0n} onClick={() => onOpen("yield")} className="min-h-11 w-full rounded-xl border border-emerald/30 bg-emerald/10 py-2 text-center text-xs font-semibold text-emerald shadow-sm shadow-emerald/20 transition-all hover:bg-emerald/20 disabled:cursor-not-allowed disabled:opacity-50">
            Withdraw Yield
          </button>
        </div>

        {/* Card 3: Available spend limit */}
        <div className="group relative overflow-hidden rounded-2xl glass-card p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Available Spend Limit</span>
            <span className="font-mono text-xs font-medium text-cyan">100% yield-backed</span>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <span data-testid="limit-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">${fmtUsdc(limit)}</span>
            <span className="font-mono text-sm font-semibold text-emerald">USDG</span>
          </div>
          <div className="mb-4 flex items-center justify-between font-mono text-xs text-muted">
            <span>Borrowed: $0.00</span>
            <span className="text-cyan/80">Principal used: $0.00</span>
          </div>
          <div className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.05] px-3 py-1.5 font-mono text-xs">
            <span className="text-muted">Spendable now:</span>
            <span className="font-semibold text-cyan">${fmtUsdc(m.limits.yield)}</span>
          </div>
        </div>
      </div>

      {/* Safe status bar */}
      <div className="flex flex-col gap-3 rounded-2xl glass-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Your Safe · Robinhood Chain</p>
          <p data-testid="safe-address" className="mt-1 break-all font-mono text-sm text-fg">{m.safe ?? "…"}</p>
        </div>
        <dl className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-muted">
          <div className="flex gap-2"><dt>Status</dt><dd data-testid="safe-status" className={m.deployed ? "text-emerald" : "text-fg"}>{m.deployed ? "Active" : "Created on first deposit"}</dd></div>
          <div className="flex gap-2"><dt>Wallet USDG</dt><dd data-testid="wallet-usdg" className="text-fg">${fmtUsdc(m.walletUsdg)}</dd></div>
          {m.safeUsdg > 0n && (
            <div className="flex items-center gap-2">
              <dt className="text-amber">Safe Idle</dt>
              <dd data-testid="safe-idle-usdg" className="font-semibold text-amber">${fmtUsdc(m.safeUsdg)} USDG</dd>
              <button
                type="button"
                data-testid="deposit-safe-usdg"
                disabled={m.busy}
                onClick={() => void m.supplyIdle(m.safeUsdg)}
                className="rounded-lg bg-emerald/20 px-2 py-0.5 text-[11px] font-semibold text-emerald hover:bg-emerald/30 disabled:opacity-50"
              >
                + Deposit to Vault
              </button>
              <button
                type="button"
                data-testid="sweep-safe-usdg"
                disabled={m.busy}
                onClick={() => void m.withdrawSafeUsdg(m.safeUsdg)}
                className="rounded-lg bg-amber/20 px-2 py-0.5 text-[11px] font-semibold text-amber hover:bg-amber/30 disabled:opacity-50"
              >
                Sweep to Wallet
              </button>
            </div>
          )}
          {m.safe && explorer && (
            <a className="text-cyan hover:underline" href={`${explorer}/address/${m.safe}`} target="_blank" rel="noopener noreferrer">Explorer ↗</a>
          )}
        </dl>
      </div>
    </div>
  );
}
