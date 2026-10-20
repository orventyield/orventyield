"use client";

import { useMemo, useState } from "react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { BankCashout } from "@/components/dashboard/BankCashout";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import { CardPanel } from "@/components/dashboard/mainnet/CardPanel";
import { MainnetVaultOverview, type VaultModal } from "@/components/dashboard/mainnet/MainnetVaultOverview";
import { VoucherPanel } from "@/components/dashboard/mainnet/VoucherPanel";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { useSafeAccount } from "@/features/account/useSafeAccount";
import { useCardSuite } from "@/features/card/useCardSuite";
import { buildLedger } from "@/features/ledger/mainnetLedger";
import { useAppMode } from "@/features/mode/AppModeProvider";
import type { SpendResult } from "@/features/vault/useVaultState";
import { useVoucherShop } from "@/features/vouchers/useVoucherShop";
import { maxPrincipalWithdrawal, maxYieldWithdrawal } from "@/lib/aave/position";
import { formatExpiry } from "@/lib/immersve/stage";
import { authCode, type CardDetails } from "@/utils/card";

const EXPLORER = "https://arbiscan.io";

// Same five tabs, in the same order, as the Playground.
type Tab = "overview" | "pos" | "vouchers" | "cashout" | "activity";
type Modal = VaultModal;

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

export function MainnetDashboard() {
  const a = useSafeAccount();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [toWallet, setToWallet] = useState(true);
  const explorer = a.onFork ? undefined : EXPLORER;
  const snap = a.snapshot;
  const yieldMax = snap ? maxYieldWithdrawal(snap) : 0n;

  // One card flow and one voucher shop for the whole dashboard, so state survives tab switches.
  const suite = useCardSuite({ maxYield: yieldMax, pay: a.payFromYield, exec: a.execFromSafe });
  const shop = useVoucherShop({ owner: a.owner, safe: a.safe, maxYield: yieldMax, pay: a.payFromYield, enabled: tab === "vouchers" });
  const cardTxs = useMemo(
    () => suite.cardTransactions.filter((t) => t.creditDebitIndicator !== "credit").map((t) => ({ id: t.id, amountCents: Number(t.amount) || 0, merchant: t.cardAcceptor?.name ?? "Merchant", timestamp: Date.parse(t.transactionDate) || 0 })),
    [suite.cardTransactions],
  );
  const ledger = useMemo(() => (a.safe ? buildLedger(snap?.events ?? [], a.safe, shop.history, explorer, cardTxs) : []), [a.safe, snap?.events, shop.history, explorer, cardTxs]);

  const close = () => {
    if (a.busy) return;
    setModal(null);
    a.clearMessages();
  };
  const openModal = (m: Modal) => {
    a.clearMessages();
    setModal(m);
  };

  // The POS terminal tests a swipe against the balance that is REALLY on the card (funded from earned yield). It never charges anything.
  const active = suite.stage.stage === "active" ? suite.stage.card : null;
  const posCard: CardDetails | null = active
    ? { pan: `${active.panFirst6}••••••${active.panLast4}`, cvv: "", expiry: formatExpiry(active.expiry), network: "mastercard" }
    : null;
  const allowanceUsd = suite.cardBalanceCents / 100;
  const previewSpend = (amountUsd: number, merchant: string): SpendResult => {
    if (!active) return { success: false, error: "CARD NOT ACTIVE" };
    if (active.isBlocked) return { success: false, error: "CARD BLOCKED" };
    if (suite.cardBalanceCents <= 0) return { success: false, error: "CARD NOT FUNDED" };
    if (amountUsd > allowanceUsd + 1e-9) return { success: false, error: "EXCEEDS CARD BALANCE" };
    const now = new Date();
    return {
      success: true,
      source: "mainnet-preview",
      receipt: {
        authCode: authCode(`${active.id}:${merchant}:${amountUsd}:${now.getTime()}`),
        timestampIso: now.toISOString(),
        merchant,
        amountUsd,
        txHash: null,
        funding: { fromYield: amountUsd },
        source: "mainnet-preview",
      },
    };
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

  return (
    <div className="space-y-6" data-testid="mainnet-dashboard">
      {/* Navigation tabs: identical to the Playground */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 pb-2 font-mono text-xs">
        {([
          ["overview", "Vault & Card", "🏛️", "tab-vault"],
          ["pos", "POS Terminal Simulator", "💳", "tab-pos"],
          ["vouchers", "Voucher Store", "🎁", "tab-vouchers"],
          ["cashout", "1-Click Bank / UPI", "🏦", "tab-cashout"],
          ["activity", `Ledger (${ledger.length})`, "📜", "tab-activity"],
        ] as const).map(([id, label, icon, testId]) => (
          <button
            key={id}
            type="button"
            data-testid={testId}
            onClick={() => setTab(id)}
            className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 font-medium transition-all ${
              tab === id ? "border border-cyan/40 bg-cyan/15 font-bold text-cyan shadow-sm shadow-cyan/20" : "border border-white/5 bg-surface text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Card session, voucher purchase and ledger state live in hooks above, so switching tabs loses nothing. */}
      {tab === "overview" && (
      <div className="space-y-6">
        <MainnetVaultOverview a={a} open={openModal} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6"><CardPanel suite={suite} txSteps={a.steps} accountBusy={a.busy} explorer={explorer} /></div>
          <div className="lg:col-span-6">
            {posCard ? (
              <PosSimulator
                card={posCard}
                isCardFrozen={!!active?.isBlocked}
                spendableUsd={allowanceUsd}
                onSpendCard={previewSpend}
                live
              />
            ) : (
              <div data-testid="pos-locked" className="h-full rounded-2xl border border-white/5 bg-surface p-5">
                <h3 className="text-base font-bold text-fg">POS Merchant Terminal</h3>
                <p className="mt-2 text-sm text-muted">Get your virtual card and fund it with earned yield first. Then you can test a swipe at Uber, Starbucks or Amazon against the money on your card.</p>
              </div>
            )}
          </div>
        </div>
        <ActivityFeed transactions={ledger.slice(0, 5)} live />
      </div>
      )}

      {tab === "pos" && (
      <div className="space-y-6">
        {posCard ? (
          <PosSimulator card={posCard} isCardFrozen={!!active?.isBlocked} spendableUsd={allowanceUsd} onSpendCard={previewSpend} live />
        ) : (
          <div className="rounded-2xl border border-white/5 bg-surface p-5 text-sm text-muted">Get your virtual card on the Vault &amp; Card tab to test spending here.</div>
        )}
        <ActivityFeed transactions={ledger.filter((t) => t.type === "card_spend")} live />
      </div>
      )}

      {tab === "vouchers" && (
      <div className="space-y-6">
        <VoucherPanel shop={shop} maxYield={yieldMax} tickingYield={a.tickingYield} busy={a.busy} txError={a.error} steps={a.steps} explorer={explorer} />
        <ActivityFeed transactions={ledger.filter((t) => t.type === "voucher_redeem")} live />
      </div>
      )}

      {tab === "cashout" && (
      <div className="space-y-6">
        <BankCashout
          accruedYieldUsd={Number(a.tickingYield) / 1_000_000}
          onCashout={() => ({ success: false, error: "Cashout is not available yet." })}
          unavailable="Bank and UPI payouts need a regulated off-ramp partner, which isn't connected yet. Your earned yield stays safe in the meantime."
        />
      </div>
      )}

      {tab === "activity" && (
      <div>
        <ActivityFeed transactions={ledger} live />
      </div>
      )}

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
        title="Withdraw yield"
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
