"use client";

import { motion, useScroll, useSpring } from "motion/react";
import { useRef, type ReactElement } from "react";
import { Bolt, CardIcon, Layers, Wallet } from "../ui/Icons";
import { Reveal, SplitWords } from "../ui/motion";

const STEPS: { icon: ReactElement; title: string; body: string }[] = [
  {
    icon: <Wallet />,
    title: "Connect your wallet",
    body: "MetaMask, Rainbow, Coinbase Wallet or WalletConnect. No sign-up, no email, no password.",
  },
  {
    icon: <Layers />,
    title: "Create your Safe",
    body: "One transaction sets up your own smart-contract Safe through the official Ether.fi factory. You hold the keys.",
  },
  {
    icon: <Bolt />,
    title: "Deposit and earn",
    body: "Add weETH, ETH, WETH or USDC as collateral. Watch the yield tick up live, straight from the contracts.",
  },
  {
    icon: <CardIcon />,
    title: "Spend, repay with yield",
    body: "Use the virtual card, buy vouchers or cash out to UPI. One tap repays the balance with accrued yield.",
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const scaleY = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });

  return (
    <section id="how" className="relative px-5 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyan">How it works</p>
          <h2 className="mt-5 text-[clamp(2rem,5.5vw,3.5rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
            <SplitWords text="From wallet to spending in four steps." wordClassName="text-gradient" />
          </h2>
          <Reveal delay={0.2}>
            <p className="mt-5 max-w-sm text-muted">
              No custody, no KYC at our layer, no waiting for approval. Everything happens on-chain between you and
              Ether.fi&rsquo;s deployed contracts.
            </p>
          </Reveal>
        </div>

        <div ref={ref} className="relative pl-12 sm:pl-16">
          <div className="absolute bottom-4 left-[19px] top-4 w-px bg-white/10 sm:left-[27px]" />
          <motion.div
            style={{ scaleY }}
            className="absolute bottom-4 left-[18px] top-4 w-[3px] origin-top rounded-full bg-gradient-to-b from-cyan to-emerald shadow-[0_0_16px_rgba(0,240,255,0.8)] sm:left-[26px]"
          />
          <ol className="space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true, margin: "-120px" }}
                  transition={{ type: "spring", stiffness: 260, damping: 16 }}
                  className="absolute -left-12 top-6 grid h-10 w-10 place-items-center rounded-full border border-cyan/50 bg-bg font-mono text-sm font-bold text-cyan shadow-[0_0_24px_rgba(0,240,255,0.5)] sm:-left-16 sm:h-14 sm:w-14 sm:text-lg"
                >
                  {i + 1}
                </motion.span>
                <Reveal delay={0.05}>
                  <div className="glass group rounded-3xl p-6 transition-colors duration-500 hover:border-cyan/40 sm:p-8">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan/10 text-2xl text-cyan transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6">
                      {s.icon}
                    </span>
                    <h3 className="mt-5 text-xl font-bold tracking-tight sm:text-2xl">{s.title}</h3>
                    <p className="mt-2 text-muted">{s.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
