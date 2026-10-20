"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { ChipEmblem, ContactlessWave, MastercardMark } from "@/components/ui/CardParts";
import { Logo } from "@/components/ui/Icons";
import { formatPan, type CardDetails } from "@/utils/card";

interface CardManagerProps {
  card: CardDetails;
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
  return <MastercardMark className="h-7 w-11" />;
}

export function CardManager({
  card,
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
    <div className="glass-card rounded-2xl p-5 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-fg flex flex-wrap items-center gap-2">
            Virtual Debit Card
            <span
              data-testid="card-status"
              className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-medium border ${
                isCardFrozen
                    ? "bg-danger/10 text-danger border-danger/30"
                    : "bg-emerald/10 text-emerald border-emerald/30"
              }`}
            >
              {isCardFrozen ? "FROZEN" : "ACTIVE"}
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">Playground card. Not a real payment card.</p>
        </div>

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
      </div>

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
              className={`metal-card holo-sheen absolute inset-0 flex flex-col justify-between rounded-2xl p-5 ${
                isCardFrozen ? "!border-danger/50 grayscale-[40%]" : ""
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
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] tracking-widest text-fg/80">DEBIT · DEMO</span>
              </div>

              {/* EMV chip + contactless */}
              <div className="flex items-center gap-3">
                <ChipEmblem className="h-8 w-11" />
                <ContactlessWave className="h-6 w-6 rotate-90 text-fg/60" />
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
              className="metal-card absolute inset-0 flex flex-col justify-between rounded-2xl py-5"
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
      <div className="bg-white/[0.05] border border-white/5 rounded-xl p-4 space-y-3">
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
    </div>
  );
}
