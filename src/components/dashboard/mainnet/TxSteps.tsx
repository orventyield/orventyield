"use client";

import type { TxStep } from "@/features/account/useSafeAccount";

const ICON: Record<TxStep["status"], string> = { todo: "○", wallet: "◔", pending: "◔", done: "✓", failed: "✕" };
const TONE: Record<TxStep["status"], string> = {
  todo: "text-muted",
  wallet: "text-cyan",
  pending: "text-cyan",
  done: "text-emerald",
  failed: "text-danger",
};
const NOTE: Record<TxStep["status"], string> = {
  todo: "",
  wallet: "Confirm in your wallet",
  pending: "Waiting for confirmation",
  done: "Confirmed",
  failed: "Failed",
};

/** What is about to happen, which contract, how much (frontend rule 4), then live progress per transaction. */
export function TxSteps({ steps, explorer }: { steps: TxStep[]; explorer?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol data-testid="tx-steps" className="space-y-2" aria-label="Transaction steps">
      {steps.map((s, i) => (
        <li key={s.id} data-testid={`step-${s.id}`} data-status={s.status} className="rounded-xl border border-white/5 bg-white/[0.05] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span aria-hidden="true" className={`grid h-5 w-5 place-items-center font-mono text-xs ${TONE[s.status]} ${s.status === "wallet" || s.status === "pending" ? "animate-pulse" : ""}`}>
              {ICON[s.status]}
            </span>
            <span>
              {i + 1}. {s.label}
            </span>
            {NOTE[s.status] && <span className={`ml-auto text-[11px] font-mono ${TONE[s.status]}`}>{NOTE[s.status]}</span>}
          </div>
          <p className="mt-1 pl-7 text-xs text-muted">{s.detail}</p>
          {s.hash && explorer && (
            <a className="mt-1 block pl-7 font-mono text-[11px] text-cyan hover:underline" href={`${explorer}/tx/${s.hash}`} target="_blank" rel="noopener noreferrer">
              {s.hash.slice(0, 10)}…{s.hash.slice(-6)} ↗
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
