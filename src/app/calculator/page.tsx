import type { Metadata } from "next";
import { CalculatorCard } from "@/components/landing/Calculator";
import { Block, Notice, PageShell } from "@/components/pages/PageShell";
import { SpendCalculator } from "@/components/pages/SpendCalculator";

export const metadata: Metadata = {
  title: "Calculator · OrventYield",
  description: "Estimate spendable yield, your credit line and a simplified health factor.",
};

const FORMULAS = [
  ["Yearly yield", "collateral × APY"],
  ["Monthly spendable", "yearly yield ÷ 12"],
  ["Per second", "yearly yield ÷ 31,536,000"],
  ["Max credit line", "collateral × max LTV"],
  ["Available to spend", "max credit line − outstanding debt"],
  ["Health factor (simplified)", "max credit line ÷ outstanding debt"],
];

export default function CalculatorPage() {
  return (
    <PageShell
      eyebrow="Calculator"
      title="Do the maths before you deposit."
      intro="Two quick tools. One shows what your principal can earn, the other shows how much you can spend and how safe that is. Every input is yours to change."
      next={{ href: "/features", label: "Features" }}
    >
      <Block
        title="1. How much can my principal pay for?"
        lead="Set your collateral and the APY you expect. Real yield varies and the app reads it live from Ether.fi."
      >
        <CalculatorCard />
      </Block>

      <Block
        title="2. How much can I spend, and how safe is it?"
        lead="Credit lines are based on a loan-to-value (LTV) ratio. The health factor tells you how far you are from liquidation."
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

      <Block title="How to read the health factor">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Above 1.5x", "Safe", "text-emerald", "Comfortable buffer against price swings."],
            ["1.2x to 1.5x", "Warning", "text-amber", "Thin buffer. Consider repaying or adding collateral."],
            ["Below 1.2x", "At risk", "text-danger", "Close to liquidation. Act now."],
          ].map(([r, s, c, d]) => (
            <div key={r} className="glass rounded-2xl p-5">
              <p className={`font-mono text-2xl font-extrabold ${c}`}>{r}</p>
              <p className={`mt-1 text-xs font-bold uppercase tracking-widest ${c}`}>{s}</p>
              <p className="mt-3 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="What these tools leave out">
        <Notice tone="warn">
          Borrowing interest, fees, price movements, the exact liquidation threshold per asset, and Ether.fi&rsquo;s
          real LTV limits are not modelled here. Treat results as a learning aid, not a promise. This is not financial
          advice.
        </Notice>
      </Block>
    </PageShell>
  );
}
