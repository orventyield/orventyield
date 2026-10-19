"use client";

import { motion } from "motion/react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bank, Bolt, Gift, Repeat, Shield, Snow } from "../ui/Icons";
import { Reveal, SplitWords, YieldTicker } from "../ui/motion";
import { VirtualCard } from "./VirtualCard";

function Tile({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  return (
    <Reveal delay={delay} className={className}>
      <div
        ref={ref}
        onPointerMove={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (r) setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        className="glass group relative h-full overflow-hidden rounded-3xl p-6 transition-colors duration-500 hover:border-cyan/30 sm:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: `radial-gradient(380px circle at ${pos.x}% ${pos.y}%, rgba(0,240,255,0.12), transparent 60%)` }}
        />
        <div className="relative h-full">{children}</div>
      </div>
    </Reveal>
  );
}

function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-cyan">
      <span className="text-base">{icon}</span>
      {children}
    </p>
  );
}

/* ---------- Principal lock ---------- */
const PRINCIPAL = 5000;
const MONTH_YIELD = 14.6; // example: $5,000 at about 3.5% APY

function PrincipalTile() {
  const [spend, setSpend] = useState(6);
  return (
    <>
      <Label icon={<Shield />}>Principal lock</Label>
      <h3 className="mt-3 text-xl font-bold tracking-tight">Spend the yield. Your principal never moves.</h3>
      <div className="mt-6 rounded-2xl border border-line bg-black/20 p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Principal · locked</span>
          <span className="text-emerald">Unchanged</span>
        </div>
        <p data-testid="demo-principal" className="tabular mt-1 font-mono text-3xl font-extrabold">${PRINCIPAL.toLocaleString("en-US")}.00</p>
        <p className="mt-3 text-xs text-muted">Yield left this month</p>
        <p className="tabular font-mono text-xl font-bold text-emerald">${(MONTH_YIELD - spend).toFixed(2)}</p>
      </div>
      <div className="mt-6">
        <div className="mb-2 flex justify-between text-sm">
          <label htmlFor="spend" className="text-muted">
            Spend from yield
          </label>
          <span className="font-mono font-bold">${spend.toFixed(2)}</span>
        </div>
        <input
          id="spend"
          type="range"
          min={0}
          max={MONTH_YIELD}
          step={0.1}
          value={spend}
          onChange={(e) => setSpend(Number(e.target.value))}
          style={{ "--fill": `${(spend / MONTH_YIELD) * 100}%` } as CSSProperties}
          className="w-full"
        />
        <p className="mt-3 text-xs text-muted">Example values. You can only spend what you have earned.</p>
      </div>
    </>
  );
}

/* ---------- Card controls ---------- */
function CardTile() {
  const [frozen, setFrozen] = useState(false);
  const [limit, setLimit] = useState(800);
  return (
    <div className="grid h-full items-center gap-8 md:grid-cols-2">
      <div>
        <Label icon={<Snow />}>Virtual card</Label>
        <h3 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">A card that spends your yield, not your stack.</h3>
        <p className="mt-3 text-muted">Freeze in one tap and cap your monthly draw. Try it, the card is live.</p>

        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between rounded-2xl border border-line bg-black/20 p-4">
            <span className="text-sm font-medium">{frozen ? "Card frozen" : "Card active"}</span>
            <button
              type="button"
              role="switch"
              aria-checked={frozen}
              aria-label="Freeze card"
              onClick={() => setFrozen((v) => !v)}
              className={`relative h-8 w-14 rounded-full transition-colors duration-300 ${frozen ? "bg-cyan" : "bg-white/15"}`}
            >
              <motion.span
                layout
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow ${frozen ? "right-1" : "left-1"}`}
              />
            </button>
          </div>
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <label htmlFor="limit" className="text-muted">
                Monthly limit
              </label>
              <span className="font-mono font-bold">${limit.toLocaleString("en-US")}</span>
            </div>
            <input
              id="limit"
              type="range"
              min={100}
              max={2000}
              step={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ "--fill": `${((limit - 100) / 1900) * 100}%` } as CSSProperties}
              className="w-full"
            />
          </div>
        </div>
      </div>
      <VirtualCard frozen={frozen} className="mx-auto w-full max-w-[400px]" />
    </div>
  );
}

/* ---------- Live yield ---------- */
function YieldTile() {
  return (
    <>
      <Label icon={<Bolt />}>Live yield</Label>
      <h3 className="mt-3 text-xl font-bold tracking-tight">Watch it earn, second by second.</h3>
      <YieldTicker start={128.4} perSecond={0.00041} className="mt-5 block text-3xl font-extrabold text-emerald sm:text-4xl" />
      <p className="mt-1 text-xs text-muted">Example value</p>
      <svg viewBox="0 0 300 90" className="mt-6 w-full" aria-hidden="true">
        <defs>
          <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#00F0FF" stopOpacity="0.35" />
            <stop offset="1" stopColor="#00F0FF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M0 78 C30 74 50 70 80 62 S130 56 160 44 S220 30 250 20 S285 12 300 8 L300 90 L0 90Z"
          fill="url(#spark)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.6 }}
        />
        <motion.path
          d="M0 78 C30 74 50 70 80 62 S130 56 160 44 S220 30 250 20 S285 12 300 8"
          fill="none"
          stroke="#00F0FF"
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.8, ease: "easeOut" }}
          style={{ filter: "drop-shadow(0 0 6px #00F0FF)" }}
        />
      </svg>
    </>
  );
}

/* ---------- Spend ---------- */
const VOUCHERS = ["Swiggy", "Zomato", "Amazon", "Uber", "Netflix"];

function SpendTile() {
  return (
    <>
      <Label icon={<Gift />}>Spend center</Label>
      <h3 className="mt-3 text-xl font-bold tracking-tight">Vouchers and UPI, straight from yield.</h3>
      <div className="mt-5 flex flex-wrap gap-2">
        {VOUCHERS.map((v, i) => (
          <motion.span
            key={v}
            initial={{ opacity: 0, scale: 0.7 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 * i, type: "spring", stiffness: 300, damping: 18 }}
            whileHover={{ y: -3, scale: 1.06 }}
            className="rounded-full border border-line bg-white/5 px-4 py-2 text-sm font-medium"
          >
            {v}
          </motion.span>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-black/20 p-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald/15 text-xl text-emerald">
          <Bank />
        </span>
        <div>
          <p className="text-sm font-semibold">1-tap bank / UPI cashout</p>
          <p className="text-xs text-muted">Via a non-custodial off-ramp widget</p>
        </div>
      </div>
    </>
  );
}

/* ---------- Yield refills ---------- */
function RefillTile() {
  const START = 14;
  const [left, setLeft] = useState(START);
  const spend = () => setLeft((v) => (v < 5 ? START : v - 5));
  return (
    <>
      <Label icon={<Repeat />}>Yield refills</Label>
      <h3 className="mt-3 text-xl font-bold tracking-tight">Spend it. Aave refills it.</h3>
      <div className="mt-5 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted">Spendable yield · example</p>
          <p className="tabular font-mono text-3xl font-extrabold">${left.toFixed(2)}</p>
        </div>
        <p className="text-xs text-emerald">Principal untouched</p>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan to-emerald transition-[width] duration-300"
          style={{ width: `${(left / START) * 100}%` }}
        />
      </div>
      <button
        type="button"
        onClick={spend}
        className="mt-5 min-h-12 w-full rounded-full bg-white/10 px-5 text-sm font-semibold transition hover:bg-cyan hover:text-bg active:scale-[0.98]"
      >
        {left < 5 ? "Let a few days pass" : "Spend $5 of yield"}
      </button>
    </>
  );
}

function SafeTile() {
  return (
    <>
      <Label icon={<Shield />}>Non-custodial</Label>
      <h3 className="mt-3 text-xl font-bold tracking-tight">We never touch your funds.</h3>
      <p className="mt-3 text-muted">
        OrventYield is just an interface. Your assets sit in your own Safe, and you sign every transaction.
      </p>
      <div className="mt-6 flex items-center gap-3">
        {["You", "Your Safe", "Aave"].map((n, i) => (
          <div key={n} className="flex items-center gap-3">
            <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-xs font-semibold text-cyan">{n}</span>
            {i < 2 && <span className="h-px w-5 bg-gradient-to-r from-cyan to-transparent" />}
          </div>
        ))}
      </div>
    </>
  );
}

export function BentoGrid({ className = "" }: { className?: string }) {
  return (
        <div className={`${className} grid gap-4 sm:gap-5 md:grid-cols-3`}>
          <Tile className="md:col-span-2">
            <CardTile />
          </Tile>
          <Tile delay={0.08}>
            <PrincipalTile />
          </Tile>
          <Tile delay={0.04}>
            <YieldTile />
          </Tile>
          <Tile delay={0.08}>
            <SpendTile />
          </Tile>
          <Tile delay={0.12}>
            <RefillTile />
          </Tile>
          <Tile className="md:col-span-3">
            <SafeTile />
          </Tile>
        </div>
  );
}

export function Bento() {
  return (
    <section id="features" className="relative px-5 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-cyan">Features</p>
        <h2 className="mx-auto mt-5 max-w-3xl text-center text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
          <SplitWords text="Everything a neobank does. Nothing it holds." wordClassName="text-gradient" />
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-center text-muted">Go ahead, poke at it. These are live demos.</p>

        <BentoGrid className="mt-14" />
      </div>
    </section>
  );
}
