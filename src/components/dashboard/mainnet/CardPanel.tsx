"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MastercardCard, MastercardMark } from "@/components/dashboard/mainnet/MastercardCard";
import { useCardSuite } from "@/features/card/useCardSuite";

// Loaded on demand: it pulls in the phone-number metadata, which most visits never need.
const ActivateCardDialog = dynamic(() => import("@/components/dashboard/ActivateCardDialog").then((m) => m.ActivateCardDialog), { ssr: false });

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const STEPS = [
  { id: "phone", label: "Verify phone" },
  { id: "kyc", label: "Verify identity" },
  { id: "card", label: "Get card" },
] as const;

function Progress({ stage }: { stage: string }) {
  const idx = stage === "phone" || stage === "provider-login" ? 0 : stage === "kyc" || stage === "pending" || stage === "funding" || stage === "checking" ? 1 : 2;
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

/** The unified card flow: phone OTP -> identity check -> virtual Mastercard -> single-use PAN/CVV reveal. */
export function CardPanel({ yieldBaseUnits }: { yieldBaseUnits: bigint }) {
  const s = useCardSuite(yieldBaseUnits);
  const [activating, setActivating] = useState(false);
  const st = s.stage;

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-white/5 bg-surface p-5 sm:p-6" data-testid="card-panel">
      {activating && (
        <ActivateCardDialog
          open
          onClose={() => setActivating(false)}
          onActivated={() => {
            s.markPhoneVerified();
            setActivating(false);
          }}
        />
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-fg">Your virtual Mastercard</h2>
          <p className="text-xs text-muted">Spends your yield. Your principal stays locked in Aave.</p>
        </div>
        <MastercardMark className="h-7 w-11 shrink-0" />
      </div>

      {st.stage !== "active" && st.stage !== "no-wallet" && <Progress stage={st.stage} />}

      {st.stage === "no-wallet" && <p className="text-sm text-muted">Connect your wallet to set up your card.</p>}

      {st.stage === "checking" && <div data-testid="card-checking" aria-busy="true" className="h-32 animate-pulse rounded-xl bg-surface-2" />}

      {st.stage === "phone" && (
        <Panel testId="card-step-phone">
          <p className="text-sm text-muted">First, verify your mobile number. One verified person gets one card, and we store only a salted hash of your number.</p>
          <button type="button" data-testid="card-verify-phone" onClick={() => setActivating(true)} className={primary}>Verify phone number</button>
        </Panel>
      )}

      {st.stage === "provider-login" && (
        <Panel testId="card-step-login">
          <p className="text-sm text-muted">Phone verified. Now sign in with your wallet to the card issuer. This is a free signature: no transaction and no gas.</p>
          <button type="button" data-testid="card-continue" disabled={s.busy === "login"} onClick={() => void s.connectProvider()} className={primary}>
            {s.busy === "login" ? "Waiting for your wallet…" : "Continue"}
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

      {st.stage === "funding" && (
        <Panel testId="card-step-funding">
          <p className="text-sm text-muted">The card issuer needs your card to be linked to a funding source before it can be issued. This step is not available yet.</p>
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
        <div data-testid="card-active" className="grid gap-6 md:grid-cols-[minmax(0,24rem)_1fr]">
          <MastercardCard card={st.card} secrets={s.secrets} blocked={!!st.card.isBlocked} />
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald/20 bg-emerald/5 p-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Spend allowance · your live yield</p>
              <p data-testid="card-allowance" className="mt-1 text-2xl font-extrabold text-emerald tabular">{usd(s.allowanceCents)}</p>
              <p className="mt-1 text-xs text-muted">Only earned yield can be spent. Your principal is never used.</p>
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

      {s.error && (
        <div role="alert" data-testid="card-error" className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          <span>{s.error}</span>
          <button type="button" onClick={s.dismissError} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/5">✕</button>
        </div>
      )}
    </div>
  );
}
