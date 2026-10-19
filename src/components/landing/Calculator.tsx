"use client";

import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { Reveal, SplitWords, YieldTicker } from "../ui/motion";

const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm text-muted">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-xl font-bold text-fg">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        className="w-full"
      />
    </div>
  );
}

export function CalculatorCard({ className = "" }: { className?: string }) {
  const [principal, setPrincipal] = useState(50_000);
  const [apy, setApy] = useState(3.5);

  const yearly = principal * (apy / 100);
  const monthly = yearly / 12;
  const perSecond = yearly / (365 * 24 * 3600);

  return (
        <Reveal className={className}>
          <div className="glass relative overflow-hidden rounded-[32px] p-6 sm:p-10">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan/20 blur-[90px]" />
            <div className="relative grid gap-10 lg:grid-cols-2 lg:gap-14">
              <div className="space-y-9">
                <Slider
                  id="principal"
                  label="Principal deposited"
                  value={principal}
                  min={1_000}
                  max={250_000}
                  step={1_000}
                  display={`$${fmt(principal)}`}
                  onChange={setPrincipal}
                />
                <Slider
                  id="apy"
                  label="Assumed APY (you set this)"
                  value={apy}
                  min={0.5}
                  max={10}
                  step={0.1}
                  display={`${apy.toFixed(1)}%`}
                  onChange={setApy}
                />
                <div>
                  <div className="mb-2 flex justify-between text-xs text-muted">
                    <span>Principal (locked, untouched)</span>
                    <span>Spendable yield / yr</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full bg-white/30"
                      animate={{ width: `${(principal / (principal + yearly)) * 100}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    />
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan to-emerald shadow-[0_0_20px_rgba(0,240,255,0.8)]"
                      animate={{ width: `${(yearly / (principal + yearly)) * 100}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid content-center gap-6 rounded-3xl border border-line bg-black/30 p-6 sm:p-8">
                <div>
                  <p className="text-sm text-muted">Spendable every month</p>
                  <motion.p
                    key={Math.round(monthly)}
                    initial={{ y: 10, opacity: 0.4 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="tabular mt-1 font-mono text-[clamp(2.4rem,8vw,4rem)] font-extrabold leading-none text-emerald"
                  >
                    ${fmt(monthly)}
                  </motion.p>
                </div>
                <div className="grid grid-cols-2 gap-4 border-t border-line pt-5">
                  <div>
                    <p className="text-xs text-muted">Per year</p>
                    <p className="tabular font-mono text-xl font-bold">${fmt(yearly)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Principal stays</p>
                    <p className="tabular font-mono text-xl font-bold">${fmt(principal)}</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-xs text-muted">Earning right now (per second)</p>
                  <YieldTicker
                    key={`${principal}-${apy}`}
                    start={0}
                    perSecond={perSecond}
                    decimals={7}
                    className="text-lg font-bold text-cyan sm:text-xl"
                  />
                </div>
              </div>
            </div>
            <p className="relative mt-8 text-xs leading-relaxed text-muted">
              Example only. Real yield varies and is read live from Aave. Yield is not guaranteed and
              smart-contract risk remains. This is not financial advice.
            </p>
          </div>
        </Reveal>
  );
}

export function Calculator() {
  return (
    <section id="calculator" className="relative px-5 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-cyan">Yield calculator</p>
        <h2 className="mx-auto mt-5 max-w-3xl text-center text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
          <SplitWords text="See what your principal can pay for." wordClassName="text-gradient" />
        </h2>

        <CalculatorCard className="mt-14" />
      </div>
    </section>
  );
}
