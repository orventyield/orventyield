"use client";

import { useEffect, useRef, useState } from "react";
import { TxSteps } from "@/components/dashboard/mainnet/TxSteps";
import type { TxStep } from "@/features/account/useSafeAccount";
import type { useCashout } from "@/features/cashout/useCashout";
import { fmtUsdc, parseUsdcInput } from "@/lib/aave/format";
import { parseWidgetMessage } from "@/lib/cashout/plan";

const primary = "min-h-12 rounded-xl bg-cyan px-6 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.25)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

interface Props {
  cashout: ReturnType<typeof useCashout>;
  yieldBase: bigint;
  tickingYield: bigint;
  txSteps: TxStep[];
  txError: string | null;
  explorer?: string;
}

/** Bank / UPI cashout: only EARNED YIELD can be cashed out. The amount is fixed before the provider's widget opens. */
export function CashoutPanel({ cashout: c, yieldBase, tickingYield, txSteps, txError, explorer }: Props) {
  const [text, setText] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const st = c.state;
  const amount = parseUsdcInput(text);
  const over = amount !== null && amount > yieldBase;
  const invalid = text !== "" && amount === null;
  const canStart = (text === "" ? yieldBase >= 10_000n : amount !== null && amount > 0n && !over) && st.stage === "idle";

  // Listen to the widget, but only to messages from its own frame and a Transak origin.
  const widgetUrl = st.stage === "widget" || st.stage === "lookup" ? st.widgetUrl : null;
  useEffect(() => {
    if (!widgetUrl) return;
    const onMessage = (ev: MessageEvent) => {
      const m = parseWidgetMessage(ev, frame.current?.contentWindow ?? null);
      if (m?.event === "TRANSAK_ORDER_CREATED" && m.orderId) void c.onOrderCreated(m.orderId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [widgetUrl, c]);

  if (c.unavailable) return null; // the dashboard shows its "coming soon" card instead

  return (
    <div className="space-y-5 rounded-2xl glass-card p-5" data-testid="cashout-panel">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-fg">
            1-Click Bank &amp; UPI Cashout
            <span className="rounded-full border border-cyan/20 bg-cyan/10 px-2 py-0.5 font-mono text-xs text-cyan">Transak</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">Pay out earned yield to your bank account or UPI. Your principal is never touched.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.05] px-3 py-1.5 font-mono text-xs">
          <span className="text-muted">Yield you can cash out:</span>
          <span data-testid="cashout-yield" className="font-bold text-emerald">${fmtUsdc(tickingYield)}</span>
        </div>
      </div>

      {st.stage === "idle" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) void c.start(amount === null ? null : Number(amount / 10_000n));
          }}
        >
          <label htmlFor="co-amount" className="block font-mono text-xs uppercase tracking-wider text-muted">Amount (USDC)</label>
          <div className="flex gap-2">
            <input id="co-amount" data-testid="co-amount" inputMode="decimal" autoComplete="off" placeholder={`max ${fmtUsdc(yieldBase)}`} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={invalid || over} className="min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 font-mono text-fg outline-none focus:border-cyan/60" />
            <button type="button" data-testid="co-max" disabled={yieldBase < 10_000n} onClick={() => setText(fmtMax(yieldBase))} className="min-h-12 rounded-xl border border-white/10 px-4 text-xs font-semibold text-cyan hover:bg-white/5 disabled:opacity-40">MAX</button>
          </div>
          {invalid && <p role="alert" className="text-xs text-danger">Enter a number with at most 6 decimals.</p>}
          {over && <p role="alert" data-testid="co-over" className="text-xs text-danger">Only earned yield can be cashed out: ${fmtUsdc(yieldBase)} available.</p>}
          <button type="submit" data-testid="co-start" disabled={!canStart} className={`${primary} w-full`}>Continue to bank / UPI</button>
          <p className="text-[11px] text-muted">The amount is locked before the payout page opens, so it can never be more than your earned yield. The payout provider does the identity check and shows your local options (UPI/IMPS in India, SEPA, Faster Payments, ACH).</p>
        </form>
      )}

      {st.stage === "creating" && <p data-testid="co-creating" aria-live="polite" className="text-sm text-muted">Opening the payout page…</p>}

      {(st.stage === "widget" || st.stage === "lookup") && (
        <div className="space-y-3">
          <p className="font-mono text-xs text-muted">Locked amount: <span data-testid="co-locked" className="text-fg">{st.plan.widgetAmount.toFixed(2)} USDC</span> (from earned yield)</p>
          <iframe
            ref={frame}
            data-testid="co-frame"
            title="Bank and UPI payout"
            src={st.widgetUrl}
            allow="camera;microphone;payment"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            className="h-[640px] w-full rounded-xl border border-white/10 bg-white/[0.03]"
          />
          {st.stage === "lookup" && <p data-testid="co-lookup" aria-live="polite" className="text-sm text-muted"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" />Confirming your order with the provider…</p>}
          <button type="button" onClick={c.reset} className="min-h-11 rounded-xl border border-white/10 px-5 text-xs font-semibold text-fg hover:bg-white/5">Cancel</button>
        </div>
      )}

      {st.stage === "confirm" && (
        <div data-testid="co-confirm" className="space-y-3 rounded-xl border border-cyan/20 bg-white/[0.04] p-4">
          <dl className="space-y-1 font-mono text-sm">
            <div className="flex justify-between"><dt className="text-muted">You send</dt><dd data-testid="co-send" className="text-fg">{st.order.cryptoAmount} USDC</dd></div>
            {st.order.fiatAmount !== undefined && <div className="flex justify-between"><dt className="text-muted">You receive</dt><dd className="text-emerald">{st.order.fiatAmount} {st.order.fiatCurrency}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Paid from</dt><dd className="text-emerald">your earned yield</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Principal used</dt><dd className="text-fg">$0.00</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">To</dt><dd data-testid="co-to" className="break-all text-right text-xs text-fg">{st.address}</dd></div>
          </dl>
          <p className="text-xs text-muted">Your Safe withdraws exactly this much yield from Aave and sends it to the payout provider in one transaction.</p>
          {txError && <p role="alert" data-testid="co-tx-error" className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">{txError}</p>}
          <button type="button" data-testid="co-pay" onClick={() => void c.send()} className={`${primary} w-full`}>Pay {st.order.cryptoAmount} USDC from yield</button>
          <button type="button" onClick={c.reset} className="min-h-11 w-full rounded-xl border border-white/10 text-xs font-semibold text-fg hover:bg-white/5">Cancel</button>
        </div>
      )}

      {st.stage === "sending" && (
        <div data-testid="co-sending" aria-live="polite" className="space-y-3 text-sm text-muted">
          <p className="font-semibold text-fg">Confirm in your wallet…</p>
          <TxSteps steps={txSteps} explorer={explorer} />
        </div>
      )}

      {st.stage === "sent" && (
        <p data-testid="co-sent" aria-live="polite" className="text-sm text-muted"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" />Paid. Waiting for the bank payout… <span className="font-mono text-xs">Reference {st.order.id}</span></p>
      )}

      {st.stage === "done" && (
        <div role="status" data-testid="co-done" className="space-y-3 rounded-xl border border-emerald/30 bg-emerald/10 p-4 text-sm text-emerald">
          <p className="font-semibold">Cashout complete{st.order.fiatAmount !== undefined ? `: ${st.order.fiatAmount} ${st.order.fiatCurrency} on its way to your bank.` : "."}</p>
          <button type="button" onClick={c.reset} className="min-h-11 rounded-xl border border-white/10 px-5 text-xs font-semibold text-fg hover:bg-white/5">Done</button>
        </div>
      )}

      {st.stage === "failed" && (
        <div role="alert" data-testid="co-failed" className="space-y-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <p>{st.message}</p>
          <button type="button" onClick={c.reset} className="min-h-11 rounded-xl border border-white/10 px-5 text-xs font-semibold text-fg hover:bg-white/5">Back</button>
        </div>
      )}
    </div>
  );
}

function fmtMax(v: bigint): string {
  const cents = v / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
