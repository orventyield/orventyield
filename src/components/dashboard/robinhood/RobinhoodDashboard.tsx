"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { BankCashout } from "@/components/dashboard/BankCashout";
import { ConnectGate } from "@/components/dashboard/MainnetDashboard";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import { BridgeDepositDialog } from "@/components/dashboard/mainnet/BridgeDepositDialog";
import { CardPanel } from "@/components/dashboard/mainnet/CardPanel";
import { CashoutPanel } from "@/components/dashboard/mainnet/CashoutPanel";
import { SpendShortcuts } from "@/components/dashboard/mainnet/SpendShortcuts";
import { VoucherPanel } from "@/components/dashboard/mainnet/VoucherPanel";
import { MorphoVaultOverview, type MorphoModal } from "@/components/dashboard/robinhood/MorphoVaultOverview";
import { PosSimulator } from "@/components/dashboard/PosSimulator";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { useMorphoAccount } from "@/features/account/useMorphoAccount";
import { useMorphoApy } from "@/features/account/useMorphoApy";
import { useCardSuite } from "@/features/card/useCardSuite";
import { CASHOUT_FORBIDDEN, useCashout } from "@/features/cashout/useCashout";
import { buildLedger } from "@/features/ledger/mainnetLedger";
import { useAppMode } from "@/features/mode/AppModeProvider";
import type { SpendResult } from "@/features/vault/useVaultState";
import { useVoucherShop } from "@/features/vouchers/useVoucherShop";
import type { PoolEvent } from "@/lib/aave/position";
import { ROBINHOOD, ROBINHOOD_CHAIN_ID, ROBINHOOD_EXPLORER } from "@/lib/contracts/robinhood";
import { formatExpiry } from "@/lib/immersve/stage";
import { authCode, type CardDetails } from "@/utils/card";

type Tab = "overview" | "pos" | "vouchers" | "cashout" | "activity";

/** Mainnet on Robinhood Chain: 1:1 functional & layout parity with Arbitrum One (Vault, Card, POS, Vouchers, Cashout, Activity). */
export function RobinhoodDashboard() {
  const m = useMorphoAccount();
  const { apy } = useMorphoApy();
  const { setNetwork, openWalletModal } = useAppMode();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<MorphoModal>(null);
  const explorer = m.onFork ? undefined : ROBINHOOD_EXPLORER;

  const yieldMax = m.limits.yield;
  const principalMax = m.limits.principal;
  const suite = useCardSuite({
    maxYield: yieldMax,
    maxPrincipal: principalMax,
    pay: m.payFromYield,
    payPrincipal: m.payFromPrincipal,
    exec: m.execFromSafe,
  });

  const shop = useVoucherShop({
    owner: m.owner,
    safe: m.safe,
    maxYield: yieldMax,
    pay: m.payFromYield,
    enabled: tab === "vouchers",
  });

  const cardTxs = useMemo(
    () =>
      suite.cardTransactions
        .filter((t) => t.creditDebitIndicator !== "credit")
        .map((t) => ({
          id: t.id,
          amountCents: Number(t.amount) || 0,
          merchant: t.cardAcceptor?.name ?? "Merchant",
          timestamp: Date.parse(t.transactionDate) || 0,
        })),
    [suite.cardTransactions],
  );

  const forbiddenDest = useMemo(() => [...CASHOUT_FORBIDDEN, m.safe ?? "", m.owner ?? ""], [m.safe, m.owner]);
  const cashout = useCashout({
    maxYield: yieldMax,
    pay: m.payFromYield,
    forbidden: forbiddenDest,
    enabled: tab === "cashout",
  });

  const active = suite.stage.stage === "active" ? suite.stage.card : null;
  const posCard: CardDetails | null = active
    ? {
        pan: `${active.panFirst6}••••••${active.panLast4}`,
        cvv: "",
        expiry: formatExpiry(active.expiry),
        network: "mastercard",
      }
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

  const snap = m.snapshot;
  const poolEvents: PoolEvent[] = useMemo(
    () =>
      (snap?.events ?? []).map((e) => ({
        kind: e.kind === "deposit" ? ("supply" as const) : ("withdraw" as const),
        amount: e.assets,
        counterparty: e.counterparty,
        txHash: e.txHash,
        timestamp: e.timestamp,
      })),
    [snap?.events],
  );

  const ledger = useMemo(
    () => (m.safe ? buildLedger(poolEvents, m.safe, shop.history, explorer, cardTxs) : []),
    [m.safe, poolEvents, shop.history, explorer, cardTxs],
  );

  if (m.status === "disconnected") return <ConnectGate />;
  if (m.status === "error") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl glass-card p-5 text-center">
        <div data-testid="mainnet-error" className="space-y-4 py-4">
          <h2 className="text-xl font-bold text-fg">Could not load your Robinhood Chain position</h2>
          <p className="text-sm text-muted">The network did not answer. Nothing was sent. Please try again.</p>
          <button type="button" onClick={() => void qc.invalidateQueries()} className="min-h-12 rounded-xl bg-cyan px-8 text-sm font-semibold text-bg hover:brightness-110">Try again</button>
        </div>
      </div>
    );
  }
  if (m.status === "loading") {
    return (
      <div data-testid="mainnet-loading" className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading your account">
        {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl glass-card" />)}
      </div>
    );
  }

  const close = () => {
    setModal(null);
    m.clearMessages();
  };
  const toArbitrum = () => {
    setNetwork("arbitrum");
    m.switchToArbitrum();
  };

  return (
    <div className="space-y-6" data-testid="rh-dashboard">
      {m.wrongChain && (
        <div data-testid="network-notice" role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-muted">
          <span>
            Connected on <span className="font-semibold text-fg">{m.walletChainName ?? "another network"}</span>. Everything here still loads; we switch to Robinhood Chain for you when you deposit or withdraw.
          </span>
          <button type="button" data-testid="switch-network" onClick={m.switchToRobinhood} className="min-h-9 rounded-lg border border-white/10 px-3 font-semibold text-fg hover:bg-white/5">Switch to Robinhood Chain</button>
        </div>
      )}

      {/* Navigation tabs: identical layout to Arbitrum One */}
      <SegmentedTabs<Tab>
        layoutId="rh-tab-pill"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Vault & Card", icon: "🏛️", testId: "tab-vault" },
          { id: "pos", label: "POS Terminal Simulator", icon: "💳", testId: "tab-pos" },
          { id: "vouchers", label: "Voucher Store", icon: "🎁", testId: "tab-vouchers" },
          { id: "cashout", label: "1-Click Bank / UPI", icon: "🏦", testId: "tab-cashout" },
          { id: "activity", label: `Ledger (${ledger.length})`, icon: "📜", testId: "tab-activity" },
        ]}
      />

      {tab === "overview" && (
        <div className="space-y-6">
          <MorphoVaultOverview m={m} apy={apy} onOpen={setModal} />
          <SpendShortcuts onVouchers={() => setTab("vouchers")} onCashout={() => setTab("cashout")} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <CardPanel
                suite={suite}
                txSteps={m.steps}
                accountBusy={m.busy}
                explorer={explorer}
                onSpendVouchers={() => setTab("vouchers")}
                onSpendCashout={() => setTab("cashout")}
              />
            </div>
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
                <div data-testid="pos-locked" className="h-full rounded-2xl glass-card p-5">
                  <h3 className="text-base font-bold text-fg">POS Merchant Terminal</h3>
                  <p className="mt-2 text-sm text-muted">
                    Get your virtual card and fund it with earned yield first. Then you can test a swipe at Uber, Starbucks or Amazon against the money on your card.
                  </p>
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
            <div className="rounded-2xl glass-card p-5 text-sm text-muted">Get your virtual card on the Vault &amp; Card tab to test spending here.</div>
          )}
          <ActivityFeed transactions={ledger.filter((t) => t.type === "card_spend")} live />
        </div>
      )}

      {tab === "vouchers" && (
        <div className="space-y-6">
          <VoucherPanel
            shop={shop}
            maxYield={yieldMax}
            tickingYield={yieldMax}
            busy={m.busy}
            txError={m.error}
            steps={m.steps}
            explorer={explorer}
          />
          <ActivityFeed transactions={ledger.filter((t) => t.type === "voucher_redeem")} live />
        </div>
      )}

      {tab === "cashout" && (
        <div className="space-y-6">
          {cashout.configured && !cashout.unavailable ? (
            <CashoutPanel
              cashout={cashout}
              yieldBase={yieldMax}
              tickingYield={yieldMax}
              txSteps={m.steps}
              txError={m.error}
              explorer={explorer}
            />
          ) : (
            <BankCashout
              accruedYieldUsd={Number(yieldMax) / 1_000_000}
              onCashout={() => ({ success: false, error: "Cashout is not available yet." })}
              unavailable="Bank and UPI payouts are temporarily unavailable. Nothing was sent and your earned yield stays safe. Please try again shortly."
            />
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-6">
          <ActivityFeed transactions={ledger} live />
        </div>
      )}

      {/* Bridge & Deposit Dialog */}
      {m.safe && (
        <BridgeDepositDialog
          open={modal === "bridge"}
          onClose={close}
          safe={m.safe}
          idleAmount={m.safeUsdg}
          asset="USDG"
          networkName="Robinhood Chain"
          vaultName="Morpho Steakhouse Vault"
          toChainId={ROBINHOOD_CHAIN_ID}
          toTokenAddress={ROBINHOOD.usdg}
          steps={m.steps}
          busy={m.busy}
          error={m.error}
          success={modal === "bridge" ? m.lastDone : null}
          explorer={explorer}
          onSupply={(v) => void m.supplyIdle(v)}
          onConnect={() => openWalletModal({ thenMainnet: true })}
        />
      )}

      <AmountDialog
        open={modal === "deposit"}
        onClose={close}
        testId="deposit-dialog"
        networkBadge="Robinhood Chain · USDG"
        asset="USDG"
        title="Deposit USDG"
        intro="Your USDG goes into the Steakhouse USDG vault (Morpho) from your own Safe. You can withdraw your principal any time."
        max={m.walletUsdg}
        maxLabel="In your wallet"
        confirmLabel="Deposit"
        preview={[
          ...(m.deployed ? [] : [{ label: "Create your Safe", detail: "One-time: the Safe v1.4.1 factory deploys your personal smart account on Robinhood Chain. You are its only owner." }]),
          { label: "Approve USDG", detail: "Lets the vault take exactly the amount you entered, nothing more." },
          { label: "Deposit into the vault", detail: "Deposits your USDG into the Morpho Steakhouse USDG vault for your Safe, where it earns yield." },
        ]}
        steps={m.steps}
        busy={m.busy}
        error={m.error}
        success={modal === "deposit" ? m.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void m.deposit(v)}
      >
        {m.walletUsdg === 0n && (
          <div className="mt-3 rounded-xl border border-amber/30 bg-amber/10 p-3 text-xs text-amber space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <span>⚠️</span>
              <span>No USDG in connected wallet</span>
            </div>
            <p className="text-muted leading-relaxed">
              This vault operates on Paxos Global Dollar (USDG) on Robinhood Chain. If you have USDC or funds on Arbitrum One or Ethereum, you can bridge/swap, or switch directly to Arbitrum One to deposit USDC.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={toArbitrum}
                className="rounded-lg bg-cyan px-3 py-1.5 font-semibold text-bg hover:brightness-110 transition-all text-xs"
              >
                Switch to Arbitrum One (USDC) →
              </button>
            </div>
          </div>
        )}
      </AmountDialog>

      <AmountDialog
        open={modal === "yield"}
        onClose={close}
        testId="yield-dialog"
        asset="USDG"
        title="Withdraw yield"
        intro="Only the yield you have earned can leave. Your principal stays in the vault."
        max={m.limits.yield}
        maxLabel="Yield available"
        confirmLabel="Withdraw yield"
        preview={[{ label: "Withdraw yield", detail: "Your Safe takes the yield out of the vault and sends it to your wallet in one transaction." }]}
        steps={m.steps}
        busy={m.busy}
        error={m.error}
        success={modal === "yield" ? m.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void m.withdrawYield(v, true)}
      />

      <AmountDialog
        open={modal === "principal"}
        onClose={close}
        testId="principal-dialog"
        asset="USDG"
        title="Withdraw principal"
        intro="This takes money out of the vault, so it stops earning on that amount."
        max={snap ? m.limits.principal : 0n}
        maxLabel="Principal"
        confirmLabel="Withdraw principal"
        preview={[{ label: "Withdraw principal", detail: "Your Safe takes the amount out of the vault and sends it straight to your wallet." }]}
        steps={m.steps}
        busy={m.busy}
        error={m.error}
        success={modal === "principal" ? m.lastDone : null}
        explorer={explorer}
        onSubmit={(v) => void m.withdrawPrincipal(v)}
      />
    </div>
  );
}
