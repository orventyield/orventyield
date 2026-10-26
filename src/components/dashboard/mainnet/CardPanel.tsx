"use client";

import { useState } from "react";
import { MastercardCard, MastercardMark } from "@/components/dashboard/mainnet/MastercardCard";
import { ChipEmblem, ContactlessWave } from "@/components/ui/CardParts";
import { AmountDialog } from "@/components/dashboard/mainnet/AmountDialog";
import type { TxStep } from "@/features/account/useSafeAccount";
import type { TopUpSource } from "@/lib/immersve/funding";
import type { useCardSuite } from "@/features/card/useCardSuite";

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const STEPS = [
  { id: "sign", label: "Activate card" },
  { id: "kyc", label: "Verify identity" },
  { id: "card", label: "Get card" },
] as const;

function Progress({ stage }: { stage: string }) {
  const idx = stage === "provider-login" ? 0 : stage === "kyc" || stage === "pending" || stage === "checking" ? 1 : 2;
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-[11px] font-mono" aria-label="Card setup progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2" aria-current={i === idx ? "step" : undefined}>
          <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${i < idx ? "border-emerald bg-emerald/15 text-emerald" : i === idx ? "border-cyan bg-cyan/15 text-cyan" : "border-white/10 text-muted"}`}>{i < idx ? "✓" : i + 1}</span>
          <span className={i <= idx ? "text-fg" : "text-muted"}>{s.label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-white/10" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function Panel({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="space-y-4">
      {children}
    </div>
  );
}

const primary = "min-h-12 rounded-xl bg-cyan px-8 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.25)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

/** The unified card flow: wallet signature -> identity check -> virtual Mastercard -> single-use PAN/CVV reveal. */
export function CardPanel({ suite: s, txSteps, accountBusy, explorer, onSpendVouchers, onSpendCashout }: { suite: ReturnType<typeof useCardSuite>; txSteps: TxStep[]; accountBusy: boolean; explorer?: string; onSpendVouchers: () => void; onSpendCashout: () => void }) {
  const [funding, setFunding] = useState(false);
  const [source, setSource] = useState<TopUpSource>("yield");
  const [withdrawing, setWithdrawing] = useState(false);
  const st = s.stage;

  // The card partner's production access is not switched on: never send a real user to a test sign-in or a test KYC page, and never show a card number that cannot be used.
  if (!s.cardAvailable) {
    return (
      <div className="h-full rounded-2xl glass-card p-5" data-testid="card-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-fg">Your virtual Mastercard</h2>
            <p className="text-xs text-muted">Spend earned yield worldwide while principal stays locked.</p>
          </div>
          <MastercardMark className="h-7 w-11 shrink-0" />
        </div>
        <div data-testid="card-pending-partner" className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-5">
          {/* Obsidian Metal Card Preview */}
          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl metal-card holo-sheen p-5 shadow-2xl">
            <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-cyan/20 blur-3xl" />
            <div className="relative z-10 flex aspect-[1.586/1] flex-col justify-between">
              <div className="flex items-start justify-between">
                <span className="text-sm font-extrabold tracking-tight text-fg">Orvent<span className="text-cyan">Yield</span></span>
                <span className="rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-cyan">Early Access</span>
              </div>
              <div className="flex items-center gap-3">
                <ChipEmblem className="h-9 w-12" />
                <ContactlessWave className="h-6 w-6 rotate-90 text-fg/60" />
              </div>
              <div>
                <p className="font-mono text-base tracking-[0.14em] text-fg/80 sm:text-lg">•••• •••• •••• ••••</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="font-mono text-[10px] uppercase text-muted">
                    <p>Cardholder Name</p>
                    <p className="mt-0.5">Exp ••/••</p>
                  </div>
                  <MastercardMark className="h-8 w-12" />
                </div>
              </div>
            </div>
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-bg/70 p-4 text-center backdrop-blur-[2px]">
              <span className="rounded-full border border-cyan/40 bg-cyan/15 px-3 py-1 font-mono text-xs font-semibold text-cyan">
                PARTNER ONBOARDING
              </span>
              <p className="mt-2 text-xs font-medium text-fg/90">Institutional Mastercard issuing is in final onboarding.</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center sm:text-left">
            <p className="text-sm font-semibold text-fg">Spend Your Accrued Yield Today</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              While our banking partner completes regulatory clearance for instant virtual Mastercard issuance, your accrued yield is 100% liquid and ready to spend right now via instant vouchers or direct bank transfer.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              data-testid="card-spend-vouchers"
              onClick={onSpendVouchers}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan px-4 text-xs font-semibold text-bg shadow-[0_0_20px_rgba(0,240,255,0.2)] hover:brightness-110"
            >
              <span>Instant Gift Vouchers</span>
            </button>
            <button
              type="button"
              data-testid="card-spend-cashout"
              onClick={onSpendCashout}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-xs font-semibold text-fg hover:bg-white/10"
            >
              <span>Cash Out to Bank / UPI</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-2xl glass-card p-5" data-testid="card-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-fg">Your virtual Mastercard</h2>
          <p className="text-xs text-muted">Spends your yield. Your principal stays locked in Aave.</p>
        </div>
        <MastercardMark className="h-7 w-11 shrink-0" />
      </div>

      {st.stage !== "active" && st.stage !== "no-wallet" && <Progress stage={st.stage} />}

      {st.stage === "no-wallet" && <p className="text-sm text-muted">Connect your wallet to set up your card.</p>}

      {st.stage === "checking" && <div data-testid="card-checking" aria-busy="true" className="h-32 animate-pulse rounded-xl bg-white/[0.05]" />}

      {st.stage === "provider-login" && (
        <Panel testId="card-step-login">
          <p className="text-sm text-muted">Activate your card with one free wallet signature: no transaction and no gas. It signs you in to the card issuer, Immersve.</p>
          <button type="button" data-testid="card-continue" disabled={s.busy === "login"} onClick={() => void s.connectProvider()} className={primary}>
            {s.busy === "login" ? "Waiting for your wallet…" : "Activate card"}
          </button>
        </Panel>
      )}

      {st.stage === "kyc" && (
        <Panel testId="card-step-kyc">
          <p className="text-sm text-muted">Next, a quick identity check run by the card issuer, Immersve. It opens in a new tab; come back here when you finish and this page updates by itself.</p>
          <button type="button" data-testid="card-start-kyc" onClick={() => s.openKyc(st.kycUrl)} className={primary}>Verify identity</button>
          <p className="text-[11px] font-mono text-muted" aria-live="polite">Waiting for you to finish the check…</p>
        </Panel>
      )}

      {st.stage === "pending" && (
        <Panel testId="card-step-pending">
          <p className="text-sm text-muted">Your details are being checked. This can take a few minutes. You can leave this page; your progress is saved.</p>
          <p className="font-mono text-xs text-cyan" aria-live="polite"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" />Checking…</p>
        </Panel>
      )}

      {st.stage === "issue" && (
        <Panel testId="card-step-issue">
          <p className="text-sm text-muted">You are verified. Issue your virtual Mastercard now.</p>
          <button type="button" data-testid="card-issue" disabled={s.busy === "issue"} onClick={() => void s.issueCard()} className={primary}>
            {s.busy === "issue" ? "Issuing…" : "Issue my card"}
          </button>
        </Panel>
      )}

      {st.stage === "active" && (
        <div data-testid="card-active" className="grid gap-5">
          <MastercardCard card={st.card} secrets={s.secrets} blocked={!!st.card.isBlocked} />
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald/20 bg-emerald/5 p-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Card balance · funded from your yield</p>
              <p data-testid="card-balance" className="mt-1 text-2xl font-extrabold text-emerald tabular">{usd(s.cardBalanceCents)}</p>
              <p className="mt-1 text-xs text-muted">The card can spend what is on it. Only earned yield is ever added; your principal is never used.</p>
              <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs">
                <span className="text-muted">Yield you can add: <span data-testid="card-fundable" className="text-fg">{usd(s.fundableCents)}</span></span>
                <button type="button" data-testid="card-withdraw-open" disabled={s.cardBalanceCents <= 0} onClick={() => { s.clearWithdrawal(); setWithdrawing(true); }} className="min-h-11 rounded-lg border border-white/10 px-3 font-semibold text-fg hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">
                  Withdraw to Safe
                </button>
                <button type="button" data-testid="card-fund-open" disabled={!s.fundingReady || (s.fundableCents <= 0 && s.fundablePrincipalCents <= 0)} onClick={() => { s.clearFunding(); setSource(s.fundableCents > 0 ? "yield" : "principal"); setFunding(true); void s.probeFunding(); }} className="min-h-11 rounded-lg border border-emerald/30 bg-emerald/10 px-3 font-semibold text-emerald hover:bg-emerald/20 disabled:cursor-not-allowed disabled:opacity-50">
                  Add money
                </button>
              </div>
            </div>
            {s.secrets ? (
              <button type="button" data-testid="card-hide" onClick={s.hide} className="min-h-12 w-full rounded-xl border border-white/10 text-sm font-semibold text-fg hover:bg-white/5">
                Hide details <span className="font-mono text-xs text-muted">({s.secondsLeft}s)</span>
              </button>
            ) : (
              <button type="button" data-testid="card-reveal" disabled={s.busy === "reveal"} onClick={() => void s.reveal()} className={`${primary} w-full`}>
                {s.busy === "reveal" ? "Fetching…" : "Reveal card details"}
              </button>
            )}
            <p className="text-[11px] leading-relaxed text-muted">Card numbers are fetched straight from the card issuer with a one-time link, shown here for 30 seconds, and never stored by OrventYield.</p>
            <p data-testid="card-sandbox-note" className="rounded-lg border border-amber/20 bg-amber/5 p-2 text-[11px] text-amber">Test card: the issuer&rsquo;s sandbox. It can&rsquo;t be used in shops yet.</p>
          </div>
        </div>
      )}

      <AmountDialog
        open={funding}
        onClose={() => { if (!s.funding.busy && !accountBusy) setFunding(false); }}
        testId="fund-dialog"
        title="Add money to your card"
        intro="Choose where the money comes from. Your card can only spend what you add to it."
        max={BigInt(source === "yield" ? s.fundableCents : s.fundablePrincipalCents) * 10_000n}
        maxLabel={source === "yield" ? "Earned yield available" : "Principal available"}
        confirmLabel="Add money"
        presets={[10, 25, 50, 100]}
        header={
          <fieldset className="space-y-2" disabled={s.funding.busy || accountBusy}>
            <legend className="mb-1 text-xs font-mono uppercase tracking-wider text-muted">Add from</legend>
            {([
              { id: "yield", label: "Earned yield", note: "Spend purely from your earned interest. Your principal remains 100% intact.", cents: s.fundableCents, tag: "Recommended" },
              { id: "principal", label: "Principal vault", note: "Withdraw directly from your deposited principal for larger spending. It stops earning yield on what you take out.", cents: s.fundablePrincipalCents, tag: "" },
            ] as const).map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left ${source === o.id ? "border-cyan/50 bg-cyan/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"}`}>
                <input type="radio" name="topup-source" data-testid={`topup-source-${o.id}`} checked={source === o.id} onChange={() => setSource(o.id)} className="mt-1 h-4 w-4 accent-cyan" />
                <span className="flex-1">
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold text-fg">
                    <span>{o.label} {o.tag && <span className="ml-1 rounded-full bg-emerald/15 px-2 py-0.5 text-[10px] font-mono font-medium text-emerald">{o.tag}</span>}</span>
                    <span data-testid={`topup-available-${o.id}`} className="font-mono text-xs text-muted">Available: {usd(o.cents)}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">{o.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
        }
        preview={
          s.fundingKind === "simulator"
            ? [{ label: "Sandbox deposit", detail: "The card issuer's test service credits your card with this amount. No real money moves and your balance stays in Aave." }]
            : s.fundingKind === "onchain"
              ? [source === "yield"
                  ? { label: "Withdraw yield and deposit", detail: "Your Safe withdraws exactly this much earned yield from Aave and sends it to the card issuer's funds address in one transaction. Principal is untouched." }
                  : { label: "Withdraw principal and deposit", detail: "Your Safe withdraws exactly this much of your deposited principal from Aave and sends it to the card issuer's funds address in one transaction. The rest keeps earning yield." }]
              : [{ label: "Checking how the card issuer wants to be funded", detail: "Nothing is sent until you confirm. This only takes a moment." }]
        }
        steps={s.funding.steps === "chain" ? txSteps : []}
        busy={s.funding.busy || accountBusy}
        error={s.funding.error}
        success={s.funding.done}
        explorer={explorer}
        onSubmit={(v) => void s.fund(Number(v / 10_000n), source)}
      />

      <AmountDialog
        open={withdrawing}
        onClose={() => { if (!s.withdrawal.busy && !accountBusy) setWithdrawing(false); }}
        testId="withdraw-dialog"
        title="Withdraw to your Safe"
        intro="Move money from your card back into your own Safe. Your card balance is never locked."
        max={BigInt(s.cardBalanceCents) * 10_000n}
        maxLabel="On your card"
        confirmLabel="Withdraw to Safe"
        preview={[{ label: "Withdraw to Safe", detail: s.fundingKind === "simulator" || (s.isSandbox && s.fundingKind === null) ? "The card issuer's test service releases this amount. No real money moves." : s.fundingKind === "onchain" ? "Your Safe asks the card issuer's funds contract for this amount in one transaction, and the USDC lands in your Safe." : "The card issuer releases this amount back to your Safe. Nothing is sent until you confirm." }]}
        steps={s.withdrawal.steps === "chain" ? txSteps : []}
        busy={s.withdrawal.busy || accountBusy}
        error={s.withdrawal.error}
        success={s.withdrawal.done}
        explorer={explorer}
        onSubmit={(v) => void s.withdrawToSafe(Number(v / 10_000n))}
      />

      {s.error && (
        <div role="alert" data-testid="card-error" className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          <span>{s.error}</span>
          <button type="button" onClick={s.dismissError} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/5">✕</button>
        </div>
      )}
    </div>
  );
}
