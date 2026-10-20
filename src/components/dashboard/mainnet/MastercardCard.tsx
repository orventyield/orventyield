"use client";

import { ChipEmblem, ContactlessWave, MastercardMark } from "@/components/ui/CardParts";
import { formatExpiry, groupPan, maskedPan } from "@/lib/immersve/stage";
import type { Card, CardSecrets } from "@/lib/immersve";

export { MastercardMark };

/** Ultra-premium obsidian black-metal virtual card: brushed grain, holographic sheen, gold EMV chip, contactless, Mastercard. */
export function MastercardCard({ card, secrets, blocked }: { card: Card; secrets: CardSecrets | null; blocked: boolean }) {
  const pan = secrets ? groupPan(secrets.pan) : maskedPan(card.panFirst6, card.panLast4);
  const expiry = formatExpiry(secrets ? secrets.expiry : card.expiry);
  return (
    <div data-testid="virtual-card" className="metal-card holo-sheen relative aspect-[1.586/1] w-full max-w-sm rounded-2xl p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-cyan/20 blur-3xl" />
      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <span className="text-sm font-extrabold tracking-tight text-fg">Orvent<span className="text-cyan">Yield</span></span>
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-fg/80">Virtual · Black</span>
        </div>

        <div className="flex items-center gap-3">
          <ChipEmblem className="h-9 w-12" />
          <ContactlessWave className="h-6 w-6 rotate-90 text-fg/60" />
        </div>

        <div>
          <p data-testid="card-pan" className="font-mono text-[15px] tracking-[0.1em] text-fg tabular drop-shadow-[0_1px_0_rgba(0,0,0,0.8)] min-[400px]:text-lg min-[400px]:tracking-[0.14em] sm:text-xl">{pan}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0 font-mono text-[11px] uppercase text-muted">
              <p className="truncate">{secrets?.embossedName || card.cardholderName || "Cardholder"}</p>
              <p className="mt-1 flex gap-4">
                <span>Exp <span data-testid="card-expiry" className="text-fg">{expiry}</span></span>
                <span>CVV <span data-testid="card-cvv" className="text-fg">{secrets ? secrets.cvv2 : "•••"}</span></span>
              </p>
            </div>
            <MastercardMark className="h-9 w-14 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" />
          </div>
        </div>
      </div>
      {blocked && (
        <div data-testid="card-blocked" className="absolute inset-0 z-20 grid place-items-center bg-bg/70 backdrop-blur-[2px]">
          <span className="rounded-full border border-danger/40 bg-danger/15 px-3 py-1 font-mono text-xs font-semibold text-danger">BLOCKED</span>
        </div>
      )}
    </div>
  );
}
