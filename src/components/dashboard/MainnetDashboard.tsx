"use client";

import { useState } from "react";
import { CardPanel } from "@/components/dashboard/mainnet/CardPanel";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { fmtUsdc, fmtUsdc4 } from "@/lib/aave/format";
import { maxPrincipalWithdrawal, maxYieldWithdrawal } from "@/lib/aave/position";
import { useSafeAccount } from "@/features/account/useSafeAccount";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const EXPLORER = "https://arbiscan.io";

type Tab = "vault" | "card" | "vouchers" | "cashout";
type Modal = "deposit" | "yield" | "principal" | null;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 transition-all hover:border-white/10 ${className}`}>{children}</div>;
}

function ConnectGate() {
  const { openWalletModal, setMode } = useAppMode();
  return (
    <Card className="mx-auto max-w-xl text-center">
      <div data-testid="mainnet-gate" className="space-y-4 py-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan/30 bg-cyan/10 text-2xl" aria-hidden="true">🔐</div>
        <h2 className="text-xl font-bold text-fg">Connect your wallet</h2>
        <p className="mx-auto max-w-sm text-sm text-muted">
          Deposit USDC into your own Safe. It earns yield on Aave, your principal stays locked, and you spend only the yield.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            data-testid="gate-connect"
            onClick={() => openWalletModal({ thenMainnet: true })}
            className="min-h-12 rounded-xl bg-cyan px-8 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.3)] hover:brightness-110"
          >
            Connect wallet
          </button>
          <button type="button" onClick={() => setMode("playground")} className="min-h-12 rounded-xl border border-white/10 px-6 text-sm font-semibold text-fg hover:bg-white/5">
            Try the playground
          </button>
        </div>
      </div>
    </Card>
  );
}

function Skeleton() {
  return (
    <div data-testid="mainnet-loading" className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading your account">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-44 animate-pulse rounded-2xl border border-white/5 bg-surface" />
      ))}
    </div>
  );
}

function Notice({ tone, children, testId }: { tone: "warn" | "danger"; children: React.ReactNode; testId?: string }) {
  const c = tone === "danger" ? "border-danger/30 bg-danger/10 text-danger" : "border-amber/30 bg-amber/10 text-amber";
  return (
    <div role="alert" data-testid={testId} className={`rounded-xl border p-3 text-sm ${c}`}>
      {children}
    </div>
  );
}

function Locked({ title, body }: { title: string; body: string }) {
  return (
    <Card className="mx-auto max-w-2xl text-center">
      <div data-testid="tab-locked" className="space-y-2 py-6">
        <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted">Soon</span>
        <h3 className="pt-2 text-lg font-bold text-fg">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-muted">{body}</p>
      </div>
    </Card>
  );
}

function Vault({ a, open }: { a: ReturnType<typeof useSafeAccount>; open: (m: Modal) => void }) {
  const snap = a.snapshot;
  const principal = snap?.principal ?? 0n;
  const hasPosition = (snap?.aBalance ?? 0n) > 0n;
  const explorer = a.onFork ? undefined : EXPLORER;
  const gasLow = a.walletEth === 0n;

  return (
    <div className="space-y-4">
      {gasLow && (
        <Notice tone="warn" testId="no-gas">
          Your wallet has no ETH on Arbitrum One for network gas. Add a little ETH before depositing.
        </Notice>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Principal · locked</span>
            <span className="rounded-full border border-cyan/20 bg-cyan/10 px-2 py-0.5 font-mono text-[11px] text-cyan">Aave v3</span>
          </div>
          <p data-testid="principal-value" className="mb-1 text-3xl font-extrabold tracking-tight text-fg tabular">${fmtUsdc(principal)}</p>
          <p className="mb-4 font-mono text-xs text-muted">USDC supplied from your Safe. Only you can move it.</p>
          <div className="flex gap-2">
            <button type="button" data-testid="open-deposit" onClick={() => open("deposit")} className="min-h-11 flex-1 rounded-xl bg-cyan text-xs font-semibold text-bg shadow-sm shadow-cyan/30 hover:brightness-110">
              + Deposit
            </button>
            <button type="button" data-testid="open-principal" disabled={principal <= 0n} onClick={() => open("principal")} className="min-h-11 flex-1 rounded-xl border border-white/10 bg-surface-2 text-xs font-semibold text-fg hover:bg-white/5 disabled:opacity-40">
              Withdraw
            </button>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Live yield</span>
            <span className="flex items-center gap-1.5 font-mono text-xs text-emerald">
              <span className={`h-2 w-2 rounded-full bg-emerald ${hasPosition ? "animate-pulse" : "opacity-40"}`} />
              {hasPosition ? "Accruing" : "Waiting for a deposit"}
            </span>
          </div>
          <p data-testid="yield-value" className="mb-1 text-3xl font-extrabold tracking-tight text-emerald tabular">${fmtUsdc4(a.tickingYield)}</p>
          <p className="mb-4 font-mono text-xs text-muted" data-testid="apy-value">
            {a.apy === null ? "APY shows after your first deposit" : `Aave pays ${(a.apy * 100).toFixed(2)}% APY right now (variable)`}
          </p>
          <button type="button" data-testid="open-yield" disabled={!snap || maxYieldWithdrawal(snap) <= 0n} onClick={() => open("yield")} className="min-h-11 w-full rounded-xl border border-emerald/30 bg-emerald/10 text-xs font-semibold text-emerald hover:bg-emerald/20 disabled:opacity-40">
            Spend / withdraw yield
          </button>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Your Safe</span>
            <span data-testid="safe-status" className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${a.deployed ? "border-emerald/20 bg-emerald/10 text-emerald" : "border-white/10 text-muted"}`}>
              {a.deployed ? "Active" : "Created on first deposit"}
            </span>
          </div>
          <p data-testid="safe-address" className="mb-1 break-all font-mono text-sm text-fg">{a.safe ?? "…"}</p>
          {a.safe && explorer && (
            <a className="font-mono text-xs text-cyan hover:underline" href={`${explorer}/address/${a.safe}`} target="_blank" rel="noopener noreferrer">
              View on Arbiscan ↗
            </a>
          )}
          <dl className="mt-4 space-y-1 font-mono text-xs text-muted">
            <div className="flex justify-between"><dt>Wallet USDC</dt><dd data-testid="wallet-usdc" className="text-fg">{fmtUsdc(a.walletUsdc)}</dd></div>
            <div className="flex justify-between"><dt>Owner</dt><dd className="text-fg">{a.owner ? short(a.owner) : "…"}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

export function MainnetDashboard() {
  const a = useSafeAccount();
  const [tab, setTab] = useState<Tab>("vault");
  const [modal, setModal] = useState<Modal>(null);
  const [toWallet, setToWallet] = useState(true);
  const explorer = a.onFork ? undefined : EXPLORER;

  const close = () => {
    if (a.busy) return;
    setModal(null);
    a.clearMessages();
  };
  const openModal = (m: Modal) => {
    a.clearMessages();
    setModal(m);
  };

  if (a.status === "disconnected") return <ConnectGate />;
  if (a.status === "wrong-chain") {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <div data-testid="wrong-network" className="space-y-4 py-4">
          <h2 className="text-xl font-bold text-fg">Switch to Arbitrum One</h2>
          <p className="mx-auto max-w-sm text-sm text-muted">OrventYield runs on Arbitrum One. Your wallet is on a different network.</p>
          <button type="button" data-testid="switch-network" onClick={a.switchToArbitrum} className="min-h-12 rounded-xl bg-cyan px-8 text-sm font-semibold text-bg hover:brightness-110">
            Switch network
          </button>
        </div>
      </Card>
    );
  }
  if (a.status === "error") {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <div data-testid="mainnet-error" className="space-y-4 py-4">
          <h2 className="text-xl font-bold text-fg">We couldn&rsquo;t read your account</h2>
          <p className="mx-auto max-w-sm text-sm text-muted">The Arbitrum network didn&rsquo;t answer. Nothing was changed. Check your connection and try again.</p>
          <button type="button" onClick={a.retry} className="min-h-12 rounded-xl border border-white/10 px-8 text-sm font-semibold text-fg hover:bg-white/5">Try again</button>
        </div>
      </Card>
    );
  }
  if (a.status === "loading") return <Skeleton />;

  const snap = a.snapshot;
  const yieldMax = snap ? maxYieldWithdrawal(snap) : 0n;

  return (
    <div className="space-y-6" data-testid="mainnet-dashboard">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 pb-2 font-mono text-xs">
        {([
          ["vault", "Vault", "🏛️"],
          ["card", "Card", "💳"],
          ["vouchers", "Vouchers", "🎁"],
          ["cashout", "Bank / UPI", "🏦"],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-4 font-medium transition-all ${
              tab === id ? "border border-cyan/40 bg-cyan/15 font-bold text-cyan shadow-sm shadow-cyan/20" : "border border-white/5 bg-surface text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {tab === "vault" && <Vault a={a} open={openModal} />}
      {tab === "card" && <CardPanel yieldBaseUnits={snap?.yieldAvailable ?? 0n} />}
      {tab === "vouchers" && <Locked title="Spend yield on vouchers" body="Buy Amazon, Uber, Zomato and Swiggy vouchers straight from the yield you have earned. Your principal is never used." />}
      {tab === "cashout" && <Locked title="Cash out yield to your bank" body="Move earned yield to a bank account or UPI through a regulated off-ramp. Only yield, never principal." />}

      <AmountDialog
        open={modal === "deposit"}
        onClose={close}
        testId="deposit-dialog"
        title="Deposit USDC"
        intro="Your USDC goes into Aave from your own Safe. You can withdraw your principal any time."
        max={a.walletUsdc}
        maxLabel="In your wallet"
        confirmLabel="Deposit"
        preview={[
          ...(a.deployed ? [] : [{ label: "Create your Safe", detail: "One-time: the Safe v1.4.1 factory deploys your personal smart account. You are its only owner." }]),
          { label: "Approve USDC", detail: "Lets the Aave Pool take exactly the amount you entered, nothing more." },
          { label: "Deposit into Aave", detail: "Supplies your USDC to the Aave v3 Pool for your Safe, where it earns yield." },
        ]}
        steps={a.steps}
        busy={a.busy}
        error={a.error}
        success={modal === "deposit" ? a.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void a.deposit(v)}
      />

      <AmountDialog
        open={modal === "yield"}
        onClose={close}
        testId="yield-dialog"
        title="Spend yield"
        intro="Only the yield you have earned can leave. Your principal stays locked in Aave."
        max={yieldMax}
        maxLabel="Yield available"
        confirmLabel="Withdraw yield"
        preview={[{ label: "Withdraw yield", detail: toWallet ? "Your Safe takes the yield out of Aave and sends it to your wallet in one transaction." : "Your Safe takes the yield out of Aave and keeps it as USDC in the Safe." }]}
        steps={a.steps}
        busy={a.busy}
        error={a.error}
        success={modal === "yield" ? a.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void a.withdrawYield(v, toWallet)}
      >
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={toWallet} disabled={a.busy} onChange={(e) => setToWallet(e.target.checked)} className="h-4 w-4 accent-cyan" />
          Send it to my wallet
        </label>
      </AmountDialog>

      <AmountDialog
        open={modal === "principal"}
        onClose={close}
        testId="principal-dialog"
        title="Withdraw principal"
        intro="This takes money out of your yield position, so it stops earning on that amount."
        max={snap ? maxPrincipalWithdrawal(snap) : 0n}
        maxLabel="Principal"
        confirmLabel="Withdraw principal"
        preview={[{ label: "Withdraw principal", detail: "Your Safe takes the amount out of Aave and sends it straight to your wallet." }]}
        steps={a.steps}
        busy={a.busy}
        error={a.error}
        success={modal === "principal" ? a.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void a.withdrawPrincipal(v)}
      />
    </div>
  );
}
