"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Plus } from "../ui/Icons";
import { Reveal, SplitWords } from "../ui/motion";

const FAQ = [
  {
    q: "Is OrventYield custodial?",
    a: "No. It is a front-end only. Your assets live in your own Ether.fi Safe and you sign every transaction from your own wallet.",
  },
  {
    q: "Is this affiliated with Ether.fi?",
    a: "No. OrventYield is an independent interface that connects to Ether.fi's publicly deployed contracts. Ether.fi has not endorsed it.",
  },
  {
    q: "Do I need KYC?",
    a: "OrventYield does not collect KYC or run accounts. Third-party services you may use through it, like card issuers, voucher stores or off-ramps, can have their own requirements.",
  },
  {
    q: "What are the risks?",
    a: "Borrowing against collateral can lead to liquidation if prices fall, and smart contracts always carry risk. The health gauge helps you stay safe, but nothing here is financial advice.",
  },
  {
    q: "Which chains and assets?",
    a: "Planned for Arbitrum, Base and Scroll, where Ether.fi Cash is active. Collateral: ETH, WETH, weETH and USDC.",
  },
  {
    q: "Is it live?",
    a: "Not yet. This page shows the product we're building, and the numbers in the demos are illustrative. Early access is opening soon.",
  },
];

export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const uid = useId();
  return (
        <Reveal className="mt-12">
          <div className="space-y-3">
            {items.map((f, i) => {
              const isOpen = open === i;
              return (
                <div key={f.q} className={`glass overflow-hidden rounded-2xl transition-colors ${isOpen ? "border-cyan/30" : ""}`}>
                  <h3>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`${uid}-${i}`}
                      onClick={() => setOpen(isOpen ? null : i)}
                      className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-semibold sm:px-6 sm:text-lg"
                    >
                      {f.q}
                      <motion.span
                        animate={{ rotate: isOpen ? 135 : 0 }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-cyan"
                      >
                        <Plus />
                      </motion.span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        id={`${uid}-${i}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <p className="px-5 pb-5 text-muted sm:px-6">{f.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Reveal>
  );
}

export function Faq() {
  return (
    <section id="faq" className="relative px-5 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-3xl">
        <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-cyan">FAQ</p>
        <h2 className="mt-5 text-center text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
          <SplitWords text="Straight answers." wordClassName="text-gradient" />
        </h2>

        <FaqList items={FAQ} />
      </div>
    </section>
  );
}
