import type { Metadata } from "next";
import { CalculatorCard } from "@/components/landing/Calculator";
import { Block, Notice, PageShell } from "@/components/pages/PageShell";
import { SpendCalculator } from "@/components/pages/SpendCalculator";

export const metadata: Metadata = {
  title: "Calculator · OrventYield",
  description: "Estimate your spendable yield and the principal you need for the spending you want.",
};

const FORMULAS = [
  ["Yearly yield", "principal × APY"],
  ["Monthly spendable", "yearly yield ÷ 12"],
  ["Per second", "yearly yield ÷ 31,536,000"],
  ["Principal needed", "monthly spending × 12 ÷ APY"],
  ["Can spend this month", "the smaller of what you want and the monthly yield"],
  ["Covered by yield", "monthly yield ÷ monthly spending, capped at 100%"],
];

export default function CalculatorPage() {
  return (
    <PageShell
      eyebrow="Calculator"
      title="Do the maths before you deposit."
      intro="Two quick tools. One shows what your principal can earn, the other shows how much principal you need for the spending you want. Every input is yours to change."
      next={{ href: "/features", label: "Features" }}
    >
      <Block
        title="1. How much can my principal pay for?"
        lead="Set your principal and the APY you expect. Real yield varies and the app reads it live from Aave."
      >
        <CalculatorCard />
      </Block>

      <Block
        title="2. How much principal do I need for my spending?"
        lead="Only yield is ever spent, so your monthly spending is capped by what your principal earns."
      >
        <SpendCalculator />
      </Block>

      <Block title="How we calculate" lead="No black boxes, these are the exact formulas used above.">
        <div className="overflow-hidden rounded-3xl border border-line">
          {FORMULAS.map(([k, v], i) => (
            <div key={k} className={`grid gap-1 bg-surface p-4 sm:grid-cols-[260px_1fr] sm:gap-6 sm:p-5 ${i ? "border-t border-line" : ""}`}>
              <p className="font-semibold">{k}</p>
              <p className="font-mono text-sm text-cyan sm:text-base">{v}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="What these tools leave out">
        <Notice tone="warn">
          Changes in Aave&rsquo;s yield rate, network gas, fees charged by card, voucher or cashout providers, and
          smart-contract or stablecoin risk are not modelled here. Treat results as a learning aid, not a promise. This
          is not financial advice.
        </Notice>
      </Block>
    </PageShell>
  );
}
