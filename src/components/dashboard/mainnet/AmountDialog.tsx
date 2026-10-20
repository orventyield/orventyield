"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import type { TxStep } from "@/features/account/useSafeAccount";
import { fmtUsdc, parseUsdcInput } from "@/lib/aave/format";
import { TxSteps } from "./TxSteps";

interface Props {
  open: boolean;
  onClose: () => void;
  testId: string;
  title: string;
  intro: string;
  /** Network and asset this dialog moves, shown as a badge so nobody sends the wrong token or chain. */
  networkBadge?: string;
  /** Largest allowed amount in USDC base units. */
  max: bigint;
  maxLabel: string;
  confirmLabel: string;
  /** Plan shown before signing, so the user sees exactly what will happen. */
  preview: { label: string; detail: string }[];
  steps: TxStep[];
  busy: boolean;
  error: string | null;
  success: string | null;
  explorer?: string;
  children?: ReactNode;
  onSubmit: (amount: bigint) => void;
}

export function AmountDialog(p: Props) {
  const id = useId();
  const [text, setText] = useState("");
  useEffect(() => {
    if (p.open) setText("");
  }, [p.open]);

  const amount = parseUsdcInput(text);
  const over = amount !== null && amount > p.max;
  const invalid = text !== "" && amount === null;
  const canSubmit = amount !== null && amount > 0n && !over && !p.busy && !p.success;
  const started = p.steps.length > 0;

  return (
    <Dialog open={p.open} onClose={p.onClose} labelledBy={id} testId={p.testId} dismissible={!p.busy}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-bold text-fg">{p.title}</h2>
          <p className="mt-1 text-xs text-muted">{p.intro}</p>
          {p.networkBadge && (
            <span data-testid="network-badge" className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald/30 bg-emerald/10 px-3 py-1 font-mono text-[11px] font-semibold text-emerald">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden="true" />
              {p.networkBadge}
            </span>
          )}
        </div>
        <button type="button" aria-label="Close" disabled={p.busy} onClick={p.onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg disabled:opacity-40">
          ✕
        </button>
      </div>

      {!p.success && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) p.onSubmit(amount!);
          }}
          className="space-y-3"
        >
          <label className="block text-xs font-mono uppercase tracking-wider text-muted" htmlFor={`${id}-amt`}>
            Amount (USDC)
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-amt`}
              data-testid="amount-input"
              data-autofocus
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={text}
              disabled={p.busy}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={invalid || over}
              className="min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 font-mono text-fg outline-none focus:border-cyan/60 disabled:opacity-60"
            />
            <button
              type="button"
              data-testid="amount-max"
              disabled={p.busy || p.max <= 0n}
              onClick={() => setText(fmtUsdcFull(p.max))}
              className="min-h-12 rounded-xl border border-white/10 px-4 text-xs font-semibold text-cyan hover:bg-white/5 disabled:opacity-40"
            >
              MAX
            </button>
          </div>
          <p className="text-[11px] font-mono text-muted">{p.maxLabel}: {fmtUsdc(p.max)} USDC</p>
          {invalid && <p role="alert" data-testid="amount-invalid" className="text-xs text-danger">Enter a number with at most 6 decimals.</p>}
          {over && <p role="alert" data-testid="amount-over" className="text-xs text-danger">That is more than the {fmtUsdc(p.max)} USDC available.</p>}
          {p.children}

          {!started && (
            <ol data-testid="tx-preview" className="space-y-1.5 rounded-xl border border-white/5 bg-white/[0.05] p-3 text-xs text-muted">
              <li className="font-mono uppercase tracking-wider text-[10px] text-muted/80">What will happen</li>
              {p.preview.map((s, i) => (
                <li key={s.label}>
                  <span className="font-semibold text-fg">{i + 1}. {s.label}.</span> {s.detail}
                </li>
              ))}
            </ol>
          )}
          {started && <TxSteps steps={p.steps} explorer={p.explorer} />}

          {p.error && (
            <div role="alert" data-testid="tx-error" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              {p.error}
            </div>
          )}

          <button
            type="submit"
            data-testid="amount-confirm"
            disabled={!canSubmit}
            className="min-h-12 w-full rounded-xl bg-cyan px-6 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.25)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {p.busy ? "Working…" : p.error && started ? "Try again" : p.confirmLabel}
          </button>
        </form>
      )}

      {p.success && (
        <div className="space-y-3">
          <TxSteps steps={p.steps} explorer={p.explorer} />
          <div role="status" data-testid="tx-success" className="rounded-xl border border-emerald/30 bg-emerald/10 p-3 text-sm text-emerald">
            {p.success}
          </div>
          <button type="button" onClick={p.onClose} className="min-h-12 w-full rounded-xl border border-white/10 text-sm font-semibold text-fg hover:bg-white/5">
            Done
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** Full-precision string for the MAX button (no thousands separators, trailing zeros trimmed). */
function fmtUsdcFull(v: bigint): string {
  const w = v / 1_000_000n;
  const f = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}
