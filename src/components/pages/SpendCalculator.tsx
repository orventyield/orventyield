"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { coverage, monthlyYield, principalNeeded, spendPlan } from "@/utils/yieldCalc";
import { Slider } from "../landing/Calculator";
import { Reveal } from "../ui/motion";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** "How much principal do I need for the spending I want?" Yield-only: spending is capped at yield by design. */
export function SpendCalculator() {
  const [principal, setPrincipal] = useState(20_000);
  const [apy, setApy] = useState(3.5);
  const [wish, setWish] = useState(100);

  const y = monthlyYield(principal, apy);
  const plan = spendPlan(principal, apy, wish);
  const need = principalNeeded(wish, apy);
  const cover = coverage(principal, apy, wish);
  const enough = plan.shortfall === 0;
  const color = enough ? "#10B981" : "#F59E0B";

  return (
    <Reveal>
      <div className="glass relative overflow-hidden rounded-[32px] p-6 sm:p-10">
        <div className="relative grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-9">
            <Slider id="s-principal" label="Principal deposited" value={principal} min={1_000} max={250_000} step={1_000} display={`$${fmt(principal)}`} onChange={setPrincipal} />
            <Slider id="s-apy" label="Assumed APY (you set this)" value={apy} min={0.5} max={10} step={0.1} display={`${apy.toFixed(1)}%`} onChange={setApy} />
            <Slider id="s-wish" label="Monthly spending you want" value={wish} min={10} max={2_000} step={10} display={`$${fmt(wish)}`} onChange={setWish} />
          </div>

          <div className="grid content-center gap-5 rounded-3xl border border-line bg-black/30 p-6 sm:p-8">
            <div>
              <p className="text-sm text-muted">Principal needed for this spending</p>
              <motion.p
                key={Math.round(Number.isFinite(need) ? need : -1)}
                initial={{ y: 8, opacity: 0.5 }}
                animate={{ y: 0, opacity: 1 }}
                className="tabular mt-1 font-mono text-[clamp(2.2rem,7vw,3.6rem)] font-extrabold leading-none text-cyan"
              >
                {Number.isFinite(need) ? `$${fmt(need)}` : "n/a"}
              </motion.p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-5">
              <div>
                <p className="text-xs text-muted">Yield you earn per month</p>
                <p className="tabular font-mono text-xl font-bold">${fmt(y)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">You can spend per month</p>
                <p className="tabular font-mono text-xl font-bold">${fmt(plan.spendable)}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted">Covered by yield alone</p>
                  <p className="tabular font-mono text-2xl font-extrabold" style={{ color }}>
                    {Math.round(cover * 100)}%
                  </p>
                </div>
                <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest" style={{ color, background: `${color}22` }}>
                  {enough ? "Fully covered" : "Short"}
                </span>
              </div>
              {!enough && (
                <p className="mt-3 text-xs text-muted">
                  Yield covers ${fmt(plan.spendable)} of ${fmt(wish)}. OrventYield never spends your principal to fill the ${fmt(plan.shortfall)} gap.
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="relative mt-8 text-xs leading-relaxed text-muted">
          Simplified model for learning. Real yield is variable and is read live from Aave in the app.
        </p>
      </div>
    </Reveal>
  );
}
