"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { useAppMode } from "@/features/mode/AppModeProvider";
import type { SpendResult } from "@/features/vault/useVaultState";
import { checkSpend, CASH_CHAIN } from "@/lib/etherfi/spendCheck";
import { liveToAccount, type LiveSafe, type LiveTokenBalance } from "@/lib/etherfi/snapshot";
import { useLiveSafe, type UseLiveSafe } from "@/lib/etherfi/useLiveSafe";
import { authCode, generateCardDetails } from "@/utils/card";
import { getHealthStatus } from "@/utils/math";

const usd = (n: number, d = 2) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const EXPLORER = "https://optimistic.etherscan.io/address/";

type Tab = "overview" | "pos" | "vouchers" | "cashout";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/5 bg-surface p-5 ${className}`}>{children}</div>;
}

function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "emerald" | "cyan"; testId?: string }) {
  return (
    <Card className="relative overflow-hidden">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p data-testid={testId} className={`mt-2 text-3xl font-extrabold tracking-tight tabular ${tone === "emerald" ? "text-emerald" : tone === "cyan" ? "text-cyan" : "text-fg"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

/* ---------- Connect / link gates ---------- */

function ConnectGate({ onWatch }: { onWatch: () => void }) {
  const { openWalletModal, setMode } = useAppMode();
  return (
    <Card className="mx-auto max-w-xl text-center" >
      <div data-testid="mainnet-gate" className="space-y-4 py-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan/30 bg-cyan/10 text-2xl" aria-hidden="true">🔐</div>
        <h2 className="text-xl font-bold text-fg">Connect to see your live account</h2>
        <p className="mx-auto max-w-sm text-sm text-muted">
          Mainnet reads your Ether.fi Cash Safe on Optimism: balances, debt, limits and health. OrventYield only reads; it never moves funds.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            data-testid="gate-connect"
            onClick={() => openWalletModal({ thenMainnet: true })}
            className="min-h-12 rounded-xl bg-cyan px-6 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.3)] hover:brightness-110"
          >
            Connect wallet
          </button>
          <button
            type="button"
            data-testid="gate-watch"
            onClick={onWatch}
            className="min-h-12 rounded-xl border border-white/10 px-6 text-sm font-semibold text-fg hover:bg-white/5"
          >
            Watch a Safe address
          </button>
        </div>
        <button type="button" onClick={() => setMode("playground")} className="text-xs text-muted hover:text-cyan">
          or try the playground with no wallet
        </button>
      </div>
    </Card>
  );
}

function LinkSafe({ onLinked, connected }: { onLinked: (a: Address) => void; connected: boolean }) {
  const [input, setInput] = useState("");
  const candidate = useMemo(() => (isAddress(input.trim()) ? (input.trim() as Address) : null), [input]);
  const probe = useLiveSafe(candidate);

  let message: { tone: "ok" | "err" | "info"; text: string } | null = null;
  if (input.trim() && !candidate) message = { tone: "err", text: "Enter a valid 0x… address." };
  else if (candidate && probe.status === "loading") message = { tone: "info", text: "Checking on Optimism…" };
  else if (candidate && probe.status === "not-safe") message = { tone: "err", text: "That address is not an Ether.fi Safe." };
  else if (candidate && probe.status === "error") message = { tone: "err", text: "Couldn't read this address. Try again in a moment." };
  else if (candidate && probe.status === "ready" && probe.live) {
    message = {
      tone: "ok",
      text: `Ether.fi Safe found · ${probe.live.mode === "credit" ? "Credit" : "Debit"} mode · ${usd(probe.live.totalCollateralUsd)} collateral · ${probe.isOwner ? "you are an owner" : "view-only"}`,
    };
  }

  return (
    <Card className="mx-auto max-w-xl">
      <div className="space-y-4" data-testid="link-safe">
        <div>
          <h2 className="text-lg font-bold text-fg">{connected ? "Link your Ether.fi Safe" : "Watch a Safe"}</h2>
          <p className="mt-1 text-sm text-muted">
            Paste the address of your Ether.fi Cash Safe. Safes cannot be looked up from a wallet address on-chain, so we ask once and remember it on this device.
          </p>
        </div>
        <div>
          <label htmlFor="safe-input" className="mb-1 block font-mono text-xs text-muted">Safe address (Optimism)</label>
          <input
            id="safe-input"
            data-testid="safe-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-3.5 py-3 font-mono text-sm text-fg outline-none focus:border-cyan"
          />
          {message && (
            <p
              data-testid="safe-message"
              role={message.tone === "err" ? "alert" : "status"}
              className={`mt-2 text-xs ${message.tone === "ok" ? "text-emerald" : message.tone === "err" ? "text-danger" : "text-muted"}`}
            >
              {message.text}
            </p>
          )}
        </div>
        <button
          type="button"
          data-testid="safe-link"
          disabled={!(candidate && probe.status === "ready")}
          onClick={() => candidate && onLinked(candidate)}
          className="min-h-12 w-full rounded-xl bg-cyan text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {probe.status === "ready" && !probe.isOwner ? "Watch this Safe" : "Open dashboard"}
        </button>
        <p className="text-center text-[11px] text-muted/70">Don&rsquo;t have a Safe yet? Create one in the Ether.fi Cash app, then come back.</p>
      </div>
    </Card>
  );
}

/* ---------- Live portfolio ---------- */

function TokenTable({ title, rows, showRisk, testId }: { title: string; rows: LiveTokenBalance[]; showRisk?: boolean; testId: string }) {
  return (
    <Card>
      <h3 className="mb-3 text-sm font-bold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">Nothing here yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid={testId} className="w-full text-left text-xs sm:min-w-[420px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="pb-2 pr-3 font-medium">Asset</th>
                <th className="pb-2 pr-3 text-right font-medium">Balance</th>
                <th className="hidden pb-2 pr-3 text-right font-medium sm:table-cell">Price</th>
                <th className="pb-2 text-right font-medium">Value</th>
                {showRisk && <th className="pb-2 pl-3 text-right font-medium">LTV / Liq.</th>}
              </tr>
            </thead>
            <tbody className="font-mono">
              {[...rows].sort((a, b) => b.valueUsd - a.valueUsd).map((t) => (
                <tr key={t.address} className="border-t border-white/5">
                  <td className="py-2 pr-3 font-semibold text-fg">{t.symbol}</td>
                  <td className="py-2 pr-3 text-right text-muted">{t.units.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                  <td className="hidden py-2 pr-3 text-right text-muted sm:table-cell">{usd(t.priceUsd)}</td>
                  <td className="py-2 text-right text-fg">{usd(t.valueUsd)}</td>
                  {showRisk && (
                    <td className="py-2 pl-3 text-right text-muted">
                      {t.ltvBps !== null && t.liqBps !== null ? `${t.ltvBps / 100}% / ${t.liqBps / 100}%` : "n/a"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function HealthCard({ live }: { live: LiveSafe }) {
  const hf = live.healthFactor;
  const status = getHealthStatus(Number.isFinite(hf) ? hf : 999);
  const pct = Number.isFinite(hf) ? Math.min(100, Math.max(5, (hf / 3) * 100)) : 100;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
            Health factor
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-xs ${status.colorClass}`}>{status.label}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">Borrow ceiling at the liquidation threshold ÷ your debt. Liquidation happens below 1.0x.</p>
        </div>
        <span data-testid="live-hf" className="font-mono text-2xl font-black text-fg tabular">
          {Number.isFinite(hf) ? `${hf.toFixed(2)}x` : "∞ no debt"}
        </span>
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full border border-white/5 bg-surface-2" aria-hidden="true">
        <div
          className={`h-full transition-all duration-500 ${hf >= 1.5 || !Number.isFinite(hf) ? "bg-emerald" : hf >= 1.2 ? "bg-amber" : "bg-danger"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted/70">
        <span>1.0x</span>
        <span>1.2x</span>
        <span>1.5x+</span>
        <span>3.0x+</span>
      </div>
    </Card>
  );
}

function SafeHeader({ safe, state, onChange }: { safe: Address; state: UseLiveSafe; onChange: () => void }) {
  const now = useNow(1000);
  const age = state.updatedAt ? Math.max(0, Math.round((now - state.updatedAt) / 1000)) : null;
  const live = state.live;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-fg">Ether.fi Safe</span>
          <a
            data-testid="safe-address"
            href={`${EXPLORER}${safe}`}
            target="_blank"
            rel="noopener noreferrer"
            title={safe}
            className="rounded-lg border border-white/10 bg-surface-2 px-2 py-0.5 font-mono text-xs text-cyan hover:underline"
          >
            {short(safe)}
          </a>
          {live && (
            <span data-testid="safe-mode" className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] uppercase text-cyan">
              {live.mode} mode
            </span>
          )}
          <span
            data-testid="safe-role"
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
              state.isOwner ? "border-emerald/30 bg-emerald/10 text-emerald" : "border-white/10 text-muted"
            }`}
          >
            {state.isOwner ? "Owner" : "View-only"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted">Optimism · read-only{age !== null ? ` · updated ${age}s ago` : ""}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" data-testid="live-refresh" onClick={state.refetch} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted hover:text-fg">
          Refresh
        </button>
        <button type="button" data-testid="change-safe" onClick={onChange} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted hover:text-fg">
          Change Safe
        </button>
      </div>
    </Card>
  );
}

function LockedPanel({ title, body }: { title: string; body: string }) {
  const { setMode } = useAppMode();
  return (
    <Card>
      <div data-testid="locked-panel" className="mx-auto max-w-md space-y-3 py-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-surface-2 text-xl" aria-hidden="true">🔒</div>
        <h3 className="text-base font-bold text-fg">{title}</h3>
        <p className="text-sm text-muted">{body}</p>
        <button type="button" onClick={() => setMode("playground")} className="min-h-11 rounded-xl border border-cyan/30 bg-cyan/10 px-5 text-sm font-semibold text-cyan hover:bg-cyan/15">
          Open in Playground
        </button>
      </div>
    </Card>
  );
}

function LiveDashboard({ safe, onChangeSafe }: { safe: Address; onChangeSafe: () => void }) {
  const state = useLiveSafe(safe);
  const client = usePublicClient({ chainId: CASH_CHAIN });
  const [tab, setTab] = useState<Tab>("overview");
  const live = state.live;
  const card = useMemo(() => generateCardDetails(safe), [safe]);

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div data-testid="live-loading" className="grid place-items-center py-24 text-sm text-muted">
        <span className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-cyan border-t-transparent" aria-hidden="true" />
        Reading your Safe on Optimism…
      </div>
    );
  }
  if (state.status === "not-safe" || state.status === "error" || !live) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <div data-testid="live-error" className="space-y-3 py-4">
          <h2 className="text-lg font-bold text-fg">{state.status === "not-safe" ? "This isn’t an Ether.fi Safe" : "Couldn’t load this Safe"}</h2>
          <p className="text-sm text-muted">
            {state.status === "not-safe" ? "The saved address has no Ether.fi Safe on Optimism." : "The Optimism RPC didn’t answer. Check your connection and try again."}
          </p>
          <div className="flex justify-center gap-2">
            <button type="button" onClick={state.refetch} className="rounded-xl bg-cyan px-5 py-2.5 text-sm font-semibold text-bg">Retry</button>
            <button type="button" onClick={onChangeSafe} className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-fg">Change Safe</button>
          </div>
        </div>
      </Card>
    );
  }

  const onSpend = async (amountUsd: number, merchant: string): Promise<SpendResult> => {
    const now = Date.now();
    const seed = `${safe}:${now}:${amountUsd}`;
    const fallbackAccount = liveToAccount(live, { frozen: false, monthlyLimitUsd: Number.MAX_SAFE_INTEGER, spentThisMonthUsd: 0 });
    const v = await checkSpend({ client, safe, amountUsd, fallbackAccount, txSeed: seed });
    if (!v.ok) return { success: false, error: v.reason, code: v.code, source: v.source, latencyMs: v.latencyMs };
    const debtAfter = (v.mode ?? live.mode) === "credit" ? live.totalBorrowUsd + amountUsd : live.totalBorrowUsd;
    return {
      success: true,
      source: v.source,
      latencyMs: v.latencyMs,
      receipt: {
        authCode: authCode(seed),
        timestampIso: new Date(now).toISOString(),
        merchant,
        amountUsd,
        healthAfter: debtAfter > 0 ? live.liqMaxBorrowUsd / debtAfter : Infinity,
        txHash: null,
        funding: v.funding ?? null,
        source: v.source,
        latencyMs: v.latencyMs,
      },
    };
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "pos", label: "Card check" },
    { id: "vouchers", label: "Voucher store" },
    { id: "cashout", label: "Bank / UPI" },
  ];

  return (
    <div className="space-y-6" data-testid="live-dashboard">
      <SafeHeader safe={safe} state={state} onChange={onChangeSafe} />

      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 pb-2 font-mono text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`live-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`whitespace-nowrap rounded-xl border px-4 py-2.5 font-medium transition-all ${
              tab === t.id ? "border-cyan/40 bg-cyan/15 font-bold text-cyan shadow-sm shadow-cyan/20" : "border-white/5 bg-surface text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Stat testId="live-collateral" label="Collateral" value={usd(live.totalCollateralUsd)} sub={`${live.collateral.length} asset${live.collateral.length === 1 ? "" : "s"}`} />
            <Stat testId="live-borrowed" label="Borrowed" value={usd(live.totalBorrowUsd)} sub={`Borrow limit ${usd(live.maxBorrowUsd)}`} />
            <Stat testId="live-spendable" label={live.mode === "credit" ? "Credit available to spend" : "Balance available to spend"} value={usd(live.mode === "credit" ? live.creditMaxSpendUsd : live.debitMaxSpendUsd)} tone="emerald" sub={live.mode === "credit" ? "Borrowing power right now" : "From token balances, no debt"} />
            <Stat testId="live-allowance" label="Spending limit left" value={usd(live.spendingLimitAllowanceUsd)} tone="cyan" sub="Set by the Safe owners" />
          </div>
          <HealthCard live={live} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TokenTable testId="live-collateral-table" title="Collateral" rows={live.collateral} showRisk />
            <TokenTable testId="live-borrows-table" title="Borrows" rows={live.borrows} />
          </div>
          <Card>
            <h3 className="text-sm font-bold text-fg">Your Ether.fi Cash card</h3>
            <p className="mt-1 text-sm text-muted">
              The card itself is issued and settled by Ether.fi&rsquo;s card partners (Reap, Rain, PIX and CardOrder), so card details and freeze controls live in the Ether.fi app. This dashboard shows your on-chain position and checks swipes against the same contracts.
            </p>
          </Card>
        </div>
      )}

      {tab === "pos" && (
        <PosSimulator
          variant="mainnet"
          card={card}
          isCardFrozen={false}
          availableLimit={live.mode === "credit" ? live.creditMaxSpendUsd : 0}
          microBuffer={0}
          accruedYieldUsd={live.mode === "debit" ? live.debitMaxSpendUsd : 0}
          summary={[
            { k: live.mode === "credit" ? "Credit available" : "Balance available", v: live.mode === "credit" ? live.creditMaxSpendUsd : live.debitMaxSpendUsd },
            { k: "Spending limit left", v: live.spendingLimitAllowanceUsd },
            { k: "Borrowed", v: live.totalBorrowUsd },
          ]}
          onSpendCard={onSpend}
        />
      )}

      {tab === "vouchers" && (
        <LockedPanel title="Gift vouchers are in the Playground" body="Live voucher fulfilment needs a licensed provider. Try the full Bitrefill-style flow in the Playground." />
      )}
      {tab === "cashout" && (
        <LockedPanel title="Bank and UPI payouts are in the Playground" body="Live off-ramps run through a licensed provider. Try the full payout flow in the Playground." />
      )}
    </div>
  );
}

export function MainnetDashboard() {
  const { isConnected } = useAccount();
  const { linkedSafe, setLinkedSafe, openWalletModal } = useAppMode();
  const [stage, setStage] = useState<"auto" | "link">("auto");

  if (linkedSafe && stage === "auto") {
    return <LiveDashboard safe={linkedSafe} onChangeSafe={() => setStage("link")} />;
  }
  if (!linkedSafe && !isConnected && stage === "auto") {
    return <ConnectGate onWatch={() => setStage("link")} />;
  }
  return (
    <div className="space-y-4">
      <LinkSafe
        connected={isConnected}
        onLinked={(a) => {
          setLinkedSafe(a);
          setStage("auto");
        }}
      />
      {!isConnected && (
        <p className="text-center text-xs text-muted">
          Have a wallet?{" "}
          <button type="button" onClick={() => openWalletModal({ thenMainnet: true })} className="font-semibold text-cyan hover:underline">
            Connect it
          </button>
        </p>
      )}
    </div>
  );
}
