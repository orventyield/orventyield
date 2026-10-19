"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ButtonLink } from "../ui/Button";
import { Magnetic, SplitWords, YieldTicker } from "../ui/motion";
import { VirtualCard } from "./VirtualCard";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const cardY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section id="top" ref={ref} className="relative isolate overflow-hidden pb-24 pt-36 sm:pt-40 lg:pb-32">
      {/* background: aurora + moving perspective grid */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-[10%] -top-[10%] h-[60vmax] w-[60vmax] animate-drift-a rounded-full bg-cyan/20 blur-[110px]" />
        <div className="absolute -right-[15%] top-[10%] h-[50vmax] w-[50vmax] animate-drift-b rounded-full bg-emerald/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[20%] h-[45vmax] w-[45vmax] animate-drift-c rounded-full bg-indigo-500/15 blur-[120px]" />
        <div className="absolute inset-x-0 bottom-0 h-[55%] [perspective:500px] [mask-image:linear-gradient(to_top,black,transparent_85%)]">
          <div className="grid-floor absolute -inset-x-1/2 bottom-0 h-[200%] origin-bottom [transform:rotateX(62deg)]" />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#07080c_85%)]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-16 px-5 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
        <motion.div style={{ y: textY, opacity: fade }} className="relative">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7 }}
            className="glass inline-flex items-center gap-2.5 rounded-full py-1.5 pl-2 pr-4 text-[13px] text-muted"
          >
            <span className="relative grid h-5 w-5 place-items-center">
              <span className="absolute h-2 w-2 animate-pulse-ring rounded-full bg-emerald" />
              <span className="h-2 w-2 rounded-full bg-emerald" />
            </span>
            Powered by Safe + Aave · Non-custodial
          </motion.div>

          <h1 className="mt-6 text-[clamp(2.4rem,9vw,4.4rem)] lg:text-[clamp(3.2rem,5.1vw,4.9rem)] font-extrabold leading-[0.98] tracking-[-0.045em]">
            <SplitWords as="span" text="Spend the yield." delay={0.25} wordClassName="text-gradient" />
            <br />
            <SplitWords as="span" text="Keep the principal." delay={0.55} wordClassName="text-shimmer" />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.8 }}
            className="mt-6 max-w-xl text-[clamp(1.02rem,2.6vw,1.2rem)] leading-relaxed text-muted"
          >
            Deposit your principal into your own Safe, earn yield on Aave v3, and spend only the yield on vouchers, cashout or a
            virtual card. Your principal stays locked. No selling, no middlemen holding your keys.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.15, duration: 0.8 }}
            className="mt-9 flex flex-col gap-3 sm:flex-row"
          >
            <Magnetic>
              <ButtonLink href="/dashboard" arrow className="w-full sm:w-auto">
                Launch Neobank App
              </ButtonLink>
            </Magnetic>
            <ButtonLink href="#how" variant="ghost" className="w-full sm:w-auto">
              See how it works
            </ButtonLink>
          </motion.div>

          <motion.dl
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 1 }}
            className="mt-12 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6"
          >
            {[
              ["0", "contracts we deploy"],
              ["0", "keys we hold"],
              ["100%", "yield-only spending"],
            ].map(([n, l]) => (
              <div key={l}>
                <dt className="font-mono text-2xl font-bold text-fg sm:text-3xl">{n}</dt>
                <dd className="mt-1 text-xs leading-snug text-muted">{l}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>

        {/* card stage */}
        <motion.div style={{ y: cardY }} className="relative mx-auto mb-10 w-full max-w-[460px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.85, rotateX: 25, y: 60 }}
            animate={{ opacity: 1, scale: 1, rotateX: 0, y: 0 }}
            transition={{ delay: 0.5, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="animate-float">
              <VirtualCard />
            </div>
          </motion.div>

          {/* floating data chips */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.5, duration: 0.9 }}
            className="glass absolute -left-2 bottom-[-44px] rounded-2xl px-4 py-3 shadow-2xl sm:-left-12"
          >
            <p className="text-[11px] uppercase tracking-widest text-muted">Yield accrued · example</p>
            <YieldTicker start={128.4} perSecond={0.00041} className="text-xl font-bold text-emerald" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.7, duration: 0.9 }}
            className="glass absolute right-3 top-[-58px] rounded-2xl px-4 py-3 shadow-2xl sm:-right-4"
          >
            <p className="text-[11px] uppercase tracking-widest text-muted">Principal · example</p>
            <p className="flex items-center gap-2 font-mono text-xl font-bold text-cyan">
              <span className="h-2 w-2 rounded-full bg-emerald" /> $5,000
              <span className="text-xs font-medium text-emerald">Locked</span>
            </p>
          </motion.div>
        </motion.div>
      </div>

      <motion.a
        href="#proof"
        style={{ opacity: fade }}
        aria-label="Scroll down"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-xs text-muted lg:flex"
      >
        <span className="h-10 w-6 rounded-full border border-white/20 p-1">
          <motion.span
            animate={{ y: [0, 14, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="block h-2 w-full rounded-full bg-cyan"
          />
        </span>
      </motion.a>
    </section>
  );
}
