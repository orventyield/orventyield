"use client";

import type { CardSource } from "@/lib/linkedCards/cards";

/** Where the money comes from. Earned yield is the default; principal is an explicit, separate choice. */
export function SourceSelector({ value, onChange, yieldAvailable, principalAvailable, symbol, disabled }: { value: CardSource; onChange: (s: CardSource) => void; yieldAvailable: string; principalAvailable: string; symbol: string; disabled?: boolean }) {
  const options = [
    { id: "yield" as const, label: "Earned yield", note: "Spend purely from your earned interest. Your principal remains 100% intact.", available: yieldAvailable, tag: "Recommended" },
    { id: "principal" as const, label: "Principal vault", note: "Withdraw directly from your deposited principal for larger amounts. It stops earning yield on what you take out.", available: principalAvailable, tag: "" },
  ];
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-xs font-mono uppercase tracking-wider text-muted">Add from</legend>
      {options.map((o) => (
        <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left ${value === o.id ? "border-cyan/50 bg-cyan/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"}`}>
          <input type="radio" name="card-source" data-testid={`card-source-${o.id}`} checked={value === o.id} onChange={() => onChange(o.id)} className="mt-1 h-4 w-4 accent-cyan" />
          <span className="flex-1">
            <span className="flex items-center justify-between gap-2 text-sm font-semibold text-fg">
              <span>
                {o.label}
                {o.tag && <span className="ml-2 rounded-full bg-emerald/15 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald">{o.tag}</span>}
              </span>
              <span data-testid={`card-available-${o.id}`} className="font-mono text-xs text-muted">Available: {o.available} {symbol}</span>
            </span>
            <span className="mt-0.5 block text-[11px] text-muted">{o.note}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
