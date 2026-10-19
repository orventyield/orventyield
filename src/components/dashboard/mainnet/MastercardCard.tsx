"use client";

import { formatExpiry, groupPan, maskedPan } from "@/lib/immersve/stage";
import type { Card, CardSecrets } from "@/lib/immersve";

/** Mastercard mark: two overlapping circles. Drawn inline so no third-party asset is loaded. */
export function MastercardMark({ className = "h-8 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 30" className={className} role="img" aria-label="Mastercard">
      <circle cx="17" cy="15" r="13" fill="#EB001B" />
      <circle cx="31" cy="15" r="13" fill="#F79E1B" />
      <path d="M24 4.3a13 13 0 0 1 0 21.4 13 13 0 0 1 0-21.4Z" fill="#FF5F00" />
    </svg>
  );
}

export function MastercardCard({ card, secrets, blocked }: { card: Card; secrets: CardSecrets | null; blocked: boolean }) {
  const pan = secrets ? groupPan(secrets.pan) : maskedPan(card.panFirst6, card.panLast4);
  const expiry = formatExpiry(secrets ? secrets.expiry : card.expiry);
  return (
    <div
      data-testid="virtual-card"
      className="relative aspect-[1.586/1] w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0f1a22] via-[#111319] to-[#0b2a2e] p-5 shadow-[0_20px_60px_-20px_rgba(0,240,255,0.35)]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan/15 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <span className="text-sm font-extrabold tracking-tight text-fg">Orvent<span className="text-cyan">Yield</span></span>
        <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">Virtual</span>
      </div>
      <div aria-hidden="true" className="relative mt-5 h-8 w-11 rounded-md bg-gradient-to-br from-amber/80 to-amber/40" />
      <p data-testid="card-pan" className="relative mt-4 font-mono text-lg tracking-[0.14em] text-fg tabular sm:text-xl">{pan}</p>
      <div className="relative mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 font-mono text-[11px] uppercase text-muted">
          <p className="truncate">{secrets?.embossedName || card.cardholderName || "Cardholder"}</p>
          <p className="mt-1 flex gap-4">
            <span>Exp <span data-testid="card-expiry" className="text-fg">{expiry}</span></span>
            <span>CVV <span data-testid="card-cvv" className="text-fg">{secrets ? secrets.cvv2 : "•••"}</span></span>
          </p>
        </div>
        <MastercardMark />
      </div>
      {blocked && (
        <div data-testid="card-blocked" className="absolute inset-0 grid place-items-center bg-bg/70 backdrop-blur-[2px]">
          <span className="rounded-full border border-danger/40 bg-danger/15 px-3 py-1 font-mono text-xs font-semibold text-danger">BLOCKED</span>
        </div>
      )}
    </div>
  );
}
