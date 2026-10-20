"use client";

import { LiveYield } from "@/components/ui/LiveYield";
import type { useSafeAccount } from "@/features/account/useSafeAccount";
import { fmtUsdc, fmtUsdc4 } from "@/lib/aave/format";
import { maxYieldWithdrawal } from "@/lib/aave/position";

type Account = ReturnType<typeof useSafeAccount>;
export type VaultModal = "deposit" | "yield" | "principal" | null;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const EXPLORER = "https://arbiscan.io";

/**
 * The Mainnet twin of the Playground's VaultOverview: the same three stat cards and the same risk panel in the same
 * places, fed by the user's real Safe + Aave position instead of a simulation.
 */
export function MainnetVaultOverview({ a, open }: { a: Account; open: (m: VaultModal) => void }) {
  const snap = a.snapshot;
  const principal = snap?.principal ?? 0n;
  const hasPosition = (snap?.aBalance ?? 0n) > 0n;
  const explorer = a.onFork ? undefined : EXPLORER;
  const yieldMax = snap ? maxYieldWithdrawal(snap) : 0n;
  const limit = a.tickingYield > 0n ? a.tickingYield : 0n;

  return (
    <div className="space-y-6" data-testid="vault-overview">
      {a.walletEth === 0n && (
        <div role="alert" data-testid="no-gas" className="rounded-xl border border-amber/30 bg-amber/10 p-3 text-sm text-amber">
          Your wallet has no ETH on Arbitrum One for network gas. Add a little ETH before depositing.
        </div>
      )}

      {/* 3 main stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Card 1: Principal vault */}
        <div className="group relative overflow-hidden rounded-2xl glass-card p-5 transition-all hover:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Principal Vault</span>
            <div className="flex items-center gap-1.5 rounded-full border border-emerald/20 bg-emerald/10 px-2 py-0.5 text-xs font-medium text-emerald">
              <span data-testid="apy-value">{a.apy === null ? "Aave v3" : `+${(a.apy * 100).toFixed(2)}% APY`}</span>
            </div>
          </div>
          <div className="mb-1 flex items-baseline gap-2">
            <span data-testid="principal-value" className="text-3xl font-extrabold tracking-tight text-fg tabular">${fmtUsdc(principal)}</span>
          </div>
          <div className="mb-4 font-mono text-xs text-muted">Locked in Aave via your Safe · USDC</div>
          <div className="flex items-center gap-2">
            <button type="button" data-testid="open-deposit" onClick={() => open("deposit")} className="min-h-11 flex-1 rounded-xl bg-cyan py-2 text-center text-xs font-semibold text-bg shadow-sm shadow-cyan/30 transition-all hover:brightness-110">
              + Deposit USDC
            </button>
            <button type="button" data-testid="open-principal" disabled={principal <= 0n} onClick={() => open("principal")} className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.05] py-2 text-center text-xs font-semibold text-fg transition-all hover:bg-white/5 disabled:opacity-40">
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
            <LiveYield testId="yield-value" value={`$${fmtUsdc4(a.tickingYield)}`} live={hasPosition} />
          </div>
          <div className="mb-4 font-mono text-xs text-muted">
            {a.apy === null ? "Starts accruing from your first deposit" : "Read live from Aave. Variable, not guaranteed."}
          </div>
          <button type="button" data-testid="open-yield" disabled={yieldMax <= 0n} onClick={() => open("yield")} className="min-h-11 w-full rounded-xl border border-emerald/30 bg-emerald/10 py-2 text-center text-xs font-semibold text-emerald shadow-sm shadow-emerald/20 transition-all hover:bg-emerald/20 disabled:cursor-not-allowed disabled:opacity-50">
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
          </div>
          <div className="mb-4 flex items-center justify-between font-mono text-xs text-muted">
            <span>Borrowed: $0.00</span>
            <span className="text-cyan/80">Principal used: $0.00</span>
          </div>
          <div className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.05] px-3 py-1.5 font-mono text-xs">
            <span className="text-muted">Spendable now:</span>
            <span className="font-semibold text-cyan">${fmtUsdc(yieldMax)}</span>
          </div>
        </div>
      </div>

      {/* Your Safe */}
      <div className="flex flex-col gap-3 rounded-2xl glass-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Your Safe · Arbitrum One</p>
          <p data-testid="safe-address" className="mt-1 break-all font-mono text-sm text-fg">{a.safe ?? "…"}</p>
        </div>
        <dl className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-muted">
          <div className="flex gap-2"><dt>Status</dt><dd data-testid="safe-status" className={a.deployed ? "text-emerald" : "text-fg"}>{a.deployed ? "Active" : "Created on first deposit"}</dd></div>
          <div className="flex gap-2"><dt>Wallet USDC</dt><dd data-testid="wallet-usdc" className="text-fg">{fmtUsdc(a.walletUsdc)}</dd></div>
          <div className="flex gap-2"><dt>Owner</dt><dd className="text-fg">{a.owner ? short(a.owner) : "…"}</dd></div>
          {a.safe && explorer && (
            <a className="text-cyan hover:underline" href={`${explorer}/address/${a.safe}`} target="_blank" rel="noopener noreferrer">Arbiscan ↗</a>
          )}
        </dl>
      </div>

      {/* Principal safety (the Playground's health-factor panel; Mainnet has no debt, so there is nothing to liquidate) */}
      <div className="rounded-2xl glass-card p-5">
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
          <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-white/5 bg-white/[0.05]">
            <div className="h-full w-full bg-emerald transition-all duration-500" />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-muted/70">
            <span>Principal locked</span>
            <span>Yield spendable</span>
            <span>Withdraw any time</span>
          </div>
        </div>
      </div>
    </div>
  );
}
