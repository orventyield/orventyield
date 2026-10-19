"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Slider } from "../landing/Calculator";
import { Reveal } from "../ui/motion";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function SpendCalculator() {
  const [collateral, setCollateral] = useState(50_000);
  const [ltv, setLtv] = useState(50);
  const [usedPct, setUsedPct] = useState(40);

  const maxBorrow = collateral * (ltv / 100);
  const debt = maxBorrow * (usedPct / 100);
  const available = maxBorrow - debt;
  const hf = debt === 0 ? Infinity : maxBorrow / debt;

  const tone = hf >= 1.5 ? "emerald" : hf >= 1.2 ? "amber" : "danger";
  const status = hf >= 1.5 ? "Safe" : hf >= 1.2 ? "Warning" : "At risk";
  const color = { emerald: "#10B981", amber: "#F59E0B", danger: "#EF4444" }[tone];

  return (
    <Reveal>
      <div className="glass relative overflow-hidden rounded-[32px] p-6 sm:p-10">
        <div className="relative grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-9">
            <Slider
              id="s-collateral"
              label="Collateral deposited"
              value={collateral}
              min={1_000}
              max={250_000}
              step={1_000}
              display={`$${fmt(collateral)}`}
              onChange={setCollateral}
            />
            <Slider
              id="s-ltv"
              label="Max LTV (assumed, you set this)"
              value={ltv}
              min={10}
              max={90}
              step={1}
              display={`${ltv}%`}
              onChange={setLtv}
            />
            <Slider
              id="s-used"
              label="Share of limit already spent"
              value={usedPct}
              min={0}
              max={100}
              step={1}
              display={`${usedPct}%`}
              onChange={setUsedPct}
            />
          </div>

          <div className="grid content-center gap-5 rounded-3xl border border-line bg-black/30 p-6 sm:p-8">
            <div>
              <p className="text-sm text-muted">Available to spend</p>
              <motion.p
                key={Math.round(available)}
                initial={{ y: 8, opacity: 0.5 }}
                animate={{ y: 0, opacity: 1 }}
                className="tabular mt-1 font-mono text-[clamp(2.2rem,7vw,3.6rem)] font-extrabold leading-none text-cyan"
              >
                ${fmt(available)}
              </motion.p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-5">
              <div>
                <p className="text-xs text-muted">Max credit line</p>
                <p className="tabular font-mono text-xl font-bold">${fmt(maxBorrow)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Outstanding debt</p>
                <p className="tabular font-mono text-xl font-bold">${fmt(debt)}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted">Health factor (simplified)</p>
                  <p className="tabular font-mono text-2xl font-extrabold" style={{ color }}>
                    {Number.isFinite(hf) ? `${hf.toFixed(2)}x` : "No debt"}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest"
                  style={{ color, background: `${color}22` }}
                >
                  {status}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="relative mt-8 text-xs leading-relaxed text-muted">
          Simplified model for learning. Real rates and limits are set by the Aave protocol and will be read live in the app.
        </p>
      </div>
    </Reveal>
  );
}
