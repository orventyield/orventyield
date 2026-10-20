"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Logo } from "@/components/ui/Icons";
import { formatPan, type CardDetails } from "@/utils/card";

interface CardManagerProps {
  card: CardDetails;
  /** Activated through phone verification (one user = one card). */
  cardActive: boolean;
  onActivate: () => void;
  isCardFrozen: boolean;
  onToggleFreeze: () => void;
  monthlyLimit: number;
  onSetMonthlyLimit: (limit: number) => void;
  spentThisMonth: number;
  /** Earned yield: the only thing the card can spend. */
  spendableUsd: number;
}

function NetworkBadge({ network }: { network: CardDetails["network"] }) {
  if (network === "visa") {
    return (
      <span aria-label="Visa" className="text-base font-black italic tracking-tight text-cyan">
        VISA
      </span>
    );
  }
  return (
    <span aria-label="Mastercard" className="relative inline-flex h-5 w-8 items-center">
      <span className="absolute left-0 h-5 w-5 rounded-full bg-[#eb001b]/90" />
      <span className="absolute right-0 h-5 w-5 rounded-full bg-[#f79e1b]/90 mix-blend-screen" />
    </span>
  );
}

function LockedCard({ onActivate }: { onActivate: () => void }) {
  return (
    <div data-testid="card-locked" className="space-y-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="relative h-52 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#121622] via-[#090b10] to-[#040608] p-5">
          <div aria-hidden="true" className="select-none opacity-60 blur-[3px]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-fg">Orvent<span className="text-cyan">Yield</span></span>
              <span className="font-mono text-[11px] text-muted">DEBIT</span>
            </div>
            <div className="mt-8 h-7 w-10 rounded-md border border-amber-300/30 bg-amber-300/10" />
            <p className="mt-6 font-mono text-[15px] tracking-[0.14em] text-fg">•••• •••• •••• ••••</p>
            <p className="mt-2 font-mono text-[11px] text-muted">VALID THRU ••/••</p>
          </div>
          <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
            <div className="text-center">
              <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full border border-cyan/40 bg-cyan/10 text-lg" aria-hidden="true">🔒</div>
              <p className="text-sm font-semibold text-fg">Your card is ready</p>
              <p className="text-[11px] text-muted">Verify your mobile number to unlock it</p>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        data-testid="card-activate"
        onClick={onActivate}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.28)] transition hover:brightness-110"
      >
        Activate card
      </button>
      <ul className="space-y-1.5 text-[11px] text-muted">
        <li>• One verified mobile number per card, so no duplicate or bot-made cards.</li>
        <li>• We keep only a one-way fingerprint of your number, never the number itself.</li>
      </ul>
    </div>
  );
}

export function CardManager({
  card,
  cardActive,
  onActivate,
  isCardFrozen,
  onToggleFreeze,
  monthlyLimit,
  onSetMonthlyLimit,
  spentThisMonth,
  spendableUsd,
}: CardManagerProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [revealPan, setRevealPan] = useState(false);

  const percentSpent = monthlyLimit > 0 ? Math.min(100, (spentThisMonth / monthlyLimit) * 100) : 0;
  const face = { backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" } as const;

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-fg flex flex-wrap items-center gap-2">
            Virtual Debit Card
            <span
              data-testid="card-status"
              className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-medium border ${
                !cardActive
                  ? "bg-white/5 text-muted border-white/10"
                  : isCardFrozen
                    ? "bg-danger/10 text-danger border-danger/30"
                    : "bg-emerald/10 text-emerald border-emerald/30"
              }`}
            >
              {!cardActive ? "NOT ACTIVATED" : isCardFrozen ? "FROZEN" : "ACTIVE"}
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">Playground card. Not a real payment card.</p>
        </div>

        {cardActive && (
        <button
          type="button"
          data-testid="freeze-toggle"
          onClick={onToggleFreeze}
          aria-pressed={isCardFrozen}
          className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all ${
            isCardFrozen
              ? "bg-emerald/10 border-emerald/30 text-emerald hover:bg-emerald/20 shadow-sm shadow-emerald/20"
              : "bg-danger/10 border-danger/30 text-danger hover:bg-danger/20 shadow-sm shadow-danger/20"
          }`}
        >
          {isCardFrozen ? "Unfreeze Card" : "Freeze Card"}
        </button>
        )}
      </div>

      {cardActive ? (
        <motion.div
          key="active"
          data-testid="card-unlocked"
          className="space-y-6"
          initial={{ opacity: 0, scale: 0.92, filter: "blur(14px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
      {/* 3D card: flips to show the CVV */}
      <div className="flex justify-center py-2">
        <div className="w-full max-w-sm" style={{ perspective: "1000px" }}>
          <div
            role="button"
            tabIndex={0}
            data-testid="card-flip"
            aria-label={isFlipped ? "Show card front" : "Flip card to see CVV"}
            aria-pressed={isFlipped}
            onClick={() => setIsFlipped((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsFlipped((v) => !v);
              }
            }}
            className={`group relative block h-52 w-full cursor-pointer rounded-2xl transition-transform duration-700 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan ${
              isCardFrozen ? "shadow-[0_10px_40px_-10px_rgba(239,68,68,0.35)]" : "shadow-[0_10px_40px_-10px_rgba(0,240,255,0.25)]"
            }`}
            style={{ transformStyle: "preserve-3d", transform: isFlipped ? "rotateY(180deg)" : "none" }}
          >
            {/* FRONT */}
            <div
              style={face}
              className={`absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl border p-5 bg-gradient-to-br from-[#121622] via-[#090b10] to-[#040608] ${
                isCardFrozen ? "border-danger/40 grayscale-[40%]" : "border-cyan/30"
              }`}
            >
              <div className="pointer-events-none absolute -inset-full rotate-45 bg-gradient-to-r from-transparent via-cyan/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full motion-reduce:transition-none" />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Logo className="h-6 w-6 text-cyan" />
                  <span className="font-bold tracking-tight text-fg text-sm">
                    Orvent<span className="text-cyan">Yield</span>
                  </span>
                </div>
                <span className="text-[11px] font-mono text-muted/80">DEBIT · DEMO</span>
              </div>

              {/* EMV chip + contactless */}
              <div className="flex items-center gap-3">
                <div
                  aria-label="EMV chip"
                  className="grid h-7 w-10 grid-cols-3 gap-px overflow-hidden rounded-md border border-amber-300/40 bg-gradient-to-br from-amber-200/40 via-amber-400/20 to-amber-200/10 p-0.5"
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className="rounded-[1px] border border-amber-300/30" />
                  ))}
                </div>
                <svg aria-label="Contactless" className="h-5 w-5 text-muted/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M8.5 8.5a5 5 0 010 7M12 6a8.5 8.5 0 010 12M15.5 3.5a12 12 0 010 17" />
                </svg>
              </div>

              <div>
                <div data-testid="card-pan" className="mb-2 font-mono text-[15px] tracking-[0.14em] text-fg tabular">
                  {formatPan(card.pan, revealPan)}
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-muted">
                  <span data-testid="card-expiry">VALID THRU {card.expiry}</span>
                  <NetworkBadge network={card.network} />
                </div>
              </div>

              {isCardFrozen && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
                  <span className="rotate-[-12deg] rounded-md border-2 border-danger px-3 py-1 font-mono text-lg font-black tracking-widest text-danger">
                    FROZEN
                  </span>
                </div>
              )}
            </div>

            {/* BACK */}
            <div
              style={{ ...face, transform: "rotateY(180deg)" }}
              className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl border border-cyan/20 bg-gradient-to-br from-[#0c0e14] via-[#08090d] to-[#030406] py-5"
            >
              <div className="mt-2 h-9 w-full bg-black/80" />
              <div className="space-y-2 px-5">
                <div className="flex items-center justify-end rounded bg-white/10 px-3 py-1.5">
                  <span className="mr-2 font-mono text-xs text-muted">CVV</span>
                  <span data-testid="card-cvv" className="font-mono text-sm font-bold tracking-widest text-fg">
                    {card.cvv}
                  </span>
                </div>
                <p className="font-mono text-[9px] leading-tight text-muted/70">
                  Playground card for demonstration. Not a real payment card.
                </p>
              </div>
              <div className="flex items-center justify-between px-5 font-mono text-[10px] text-muted/60">
                <span>orventyield.tech</span>
                <NetworkBadge network={card.network} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted/80">
        <span>Tap the card to flip and see the CVV</span>
        <button
          type="button"
          data-testid="pan-toggle"
          onClick={() => setRevealPan((v) => !v)}
          className="rounded-lg border border-white/10 px-2.5 py-1 font-mono text-cyan hover:bg-white/5"
        >
          {revealPan ? "Hide number" : "Reveal number"}
        </button>
      </div>

      {/* Monthly budget & controls */}
      <div className="bg-surface-2 border border-white/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <label htmlFor="monthly-limit" className="text-muted">
            Monthly Spending Limit
          </label>
          <span data-testid="monthly-limit-value" className="text-fg font-semibold">
            ${monthlyLimit.toLocaleString()}
          </span>
        </div>

        <input
          id="monthly-limit"
          type="range"
          min={200}
          max={5000}
          step={100}
          value={monthlyLimit}
          onChange={(e) => onSetMonthlyLimit(Number(e.target.value))}
          style={{ ["--fill" as string]: `${((monthlyLimit - 200) / 4800) * 100}%` }}
          className="w-full cursor-pointer"
        />

        <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full bg-gradient-to-r from-cyan to-emerald transition-all" style={{ width: `${percentSpent}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs font-mono text-muted pt-1">
          <span>
            Spent: ${spentThisMonth.toFixed(2)} ({percentSpent.toFixed(1)}%)
          </span>
          <span data-testid="card-spendable">Spendable yield: ${spendableUsd.toFixed(2)}</span>
        </div>

        <div className="pt-2 border-t border-white/5 space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-muted flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              Funded by
            </span>
            <span className="text-emerald font-bold">Earned yield only</span>
          </div>
          <p className="text-[10px] leading-snug text-muted/60">
            Swipes are paid from the yield you have earned. Your principal is never used, and nothing is borrowed.
          </p>
        </div>
      </div>
        </motion.div>
      ) : (
        <LockedCard onActivate={onActivate} />
      )}
    </div>
  );
}
