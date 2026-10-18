"use client";

import { useState } from "react";
import { Logo } from "@/components/ui/Icons";

interface CardManagerProps {
  isCardFrozen: boolean;
  onToggleFreeze: () => void;
  monthlyLimit: number;
  onSetMonthlyLimit: (limit: number) => void;
  spentThisMonth: number;
  microBuffer: number;
  availableLimit: number;
}

export function CardManager({
  isCardFrozen,
  onToggleFreeze,
  monthlyLimit,
  onSetMonthlyLimit,
  spentThisMonth,
  microBuffer,
  availableLimit,
}: CardManagerProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);

  const percentSpent = Math.min(100, (spentThisMonth / monthlyLimit) * 100);

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-fg flex items-center gap-2">
            Non-Custodial Debit Card
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-medium border ${
                isCardFrozen
                  ? "bg-danger/10 text-danger border-danger/30"
                  : "bg-emerald/10 text-emerald border-emerald/30"
              }`}
            >
              {isCardFrozen ? "FROZEN" : "ACTIVE"}
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Issued via Ether.fi Cash (Arbitrum / Base). Zero banking custody.
          </p>
        </div>

        <button
          onClick={onToggleFreeze}
          className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all ${
            isCardFrozen
              ? "bg-emerald/10 border-emerald/30 text-emerald hover:bg-emerald/20 shadow-sm shadow-emerald/20"
              : "bg-danger/10 border-danger/30 text-danger hover:bg-danger/20 shadow-sm shadow-danger/20"
          }`}
        >
          {isCardFrozen ? "Unfreeze Card" : "Freeze Card"}
        </button>
      </div>

      {/* 3D Interactive Card Preview */}
      <div className="flex justify-center py-2">
        <div
          onClick={() => setIsFlipped(!isFlipped)}
          className="w-full max-w-sm h-52 cursor-pointer perspective-1000 group"
          title="Click to flip card"
        >
          <div
            className={`w-full h-full relative rounded-2xl transition-all duration-700 transform-style-3d shadow-2xl ${
              isFlipped ? "rotate-y-180" : ""
            } ${
              isCardFrozen
                ? "border-2 border-danger/40 shadow-danger/20"
                : "border border-cyan/30 shadow-[0_10px_40px_-10px_rgba(0,240,255,0.25)]"
            }`}
          >
            {/* FRONT OF CARD */}
            <div
              className={`absolute inset-0 rounded-2xl p-5 flex flex-col justify-between backface-hidden bg-gradient-to-br from-[#121622] via-[#090b10] to-[#040608] overflow-hidden ${
                isCardFrozen ? "opacity-75 grayscale-[30%]" : ""
              }`}
            >
              {/* Subtle metallic sheen line */}
              <div className="absolute -inset-full bg-gradient-to-r from-transparent via-cyan/10 to-transparent rotate-45 transform pointer-events-none group-hover:translate-x-full transition-transform duration-1000" />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Logo className="h-6 w-6 text-cyan" />
                  <span className="font-bold tracking-tight text-fg text-sm">
                    Orvent<span className="text-cyan">Yield</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-muted/80">DEBIT</span>
                  <div className="h-3 w-4 rounded bg-cyan/20 border border-cyan/40" />
                </div>
              </div>

              {/* EMV Chip & Contactless */}
              <div className="flex items-center gap-3 my-auto">
                <div className="w-10 h-7 rounded-md bg-gradient-to-br from-amber-200/40 via-amber-400/20 to-amber-200/10 border border-amber-300/40 flex items-center justify-center">
                  <div className="w-6 h-4 border border-amber-300/30 rounded-xs" />
                </div>
                <svg className="h-5 w-5 text-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a10 10 0 0114.142 0M1.343 9.343a15 15 0 0121.314 0" />
                </svg>
              </div>

              {/* Card Number & Details */}
              <div>
                <div className="flex items-center justify-between font-mono text-sm tracking-widest text-fg mb-2">
                  <span>{showNumbers ? "4291 8840 9120 7412" : "•••• •••• •••• 7412"}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowNumbers(!showNumbers);
                    }}
                    className="text-[10px] text-cyan hover:underline tracking-normal"
                  >
                    {showNumbers ? "Hide" : "Reveal"}
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-muted">
                  <span>VALID THRU 08/29</span>
                  <span className="text-cyan font-bold tracking-wide">VISA</span>
                </div>
              </div>
            </div>

            {/* BACK OF CARD */}
            <div className="absolute inset-0 rounded-2xl p-5 flex flex-col justify-between backface-hidden rotate-y-180 bg-gradient-to-br from-[#0c0e14] via-[#08090d] to-[#030406] overflow-hidden">
              <div className="h-9 w-full bg-black/80 -mx-5 mt-2" />
              <div className="space-y-2">
                <div className="flex items-center justify-end px-3 py-1.5 bg-white/10 rounded">
                  <span className="text-xs font-mono text-muted mr-2">CVV:</span>
                  <span className="text-xs font-mono font-bold text-fg tracking-wider">
                    {showNumbers ? "392" : "•••"}
                  </span>
                </div>
                <p className="text-[9px] text-muted/70 font-mono leading-tight">
                  Non-custodial smart contract proxy on Arbitrum One. Real-time yield backed. Principal remains staked.
                </p>
              </div>
              <div className="flex justify-between items-center text-[10px] text-muted/60 font-mono">
                <span>Ether.fi Safe v3</span>
                <span>orventyield.com</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-muted/70">
        💡 Click card to flip and view CVV • Auto-linked to your yield buffer
      </div>

      {/* Monthly Budget & Spending Controls */}
      <div className="bg-surface-2 border border-white/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted">Monthly Spending Limit</span>
          <span className="text-fg font-semibold">${monthlyLimit.toLocaleString()}</span>
        </div>

        <input
          type="range"
          min="200"
          max="5000"
          step="100"
          value={monthlyLimit}
          onChange={(e) => onSetMonthlyLimit(Number(e.target.value))}
          className="w-full cursor-pointer"
        />

        <div className="flex items-center justify-between text-xs font-mono text-muted pt-1">
          <span>Spent: ${spentThisMonth.toFixed(2)} ({percentSpent.toFixed(1)}%)</span>
          <span>Available Cap: ${availableLimit.toFixed(2)}</span>
        </div>

        {/* Micro-buffer callout */}
        <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs font-mono">
          <span className="text-muted flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-ping" />
            7-Day Auto Overdraft Buffer:
          </span>
          <span className="text-cyan font-bold">+${microBuffer.toFixed(2)} secured</span>
        </div>
      </div>
    </div>
  );
}
