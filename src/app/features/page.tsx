import type { Metadata } from "next";
import { BentoGrid } from "@/components/landing/Bento";
import { Block, PageShell } from "@/components/pages/PageShell";
import { Bank, Bolt, CardIcon, Check, Gift, Layers } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/motion";

export const metadata: Metadata = {
  title: "Features · OrventYield",
  description: "Everything in the first version: onboarding, vault, credit line, virtual card and spend center.",
};

const FEATURES = [
  {
    icon: <Layers />,
    title: "Wallet & Safe onboarding",
    what: "Connect a wallet and get your own Ether.fi Safe in one transaction. If you already have one, we find it.",
    points: [
      "MetaMask, Rainbow, Coinbase Wallet, WalletConnect",
      "Detects an existing EtherFiSafe automatically",
      "One-click Safe creation through the Ether.fi Cash Safe factory",
      "Clear wrong-network handling",
    ],
  },
  {
    icon: <Bolt />,
    title: "Collateral vault & live yield",
    what: "Deposit and watch your yield accrue in real time, with the numbers read straight from the contracts.",
    points: [
      "ETH, WETH, weETH and USDC",
      "Exact-amount approvals, never unlimited",
      "Live APY from the contracts",
      "Ticking counter of accrued yield",
    ],
  },
  {
    icon: <Check />,
    title: "Credit line & health factor",
    what: "See what you can spend and how safe you are, before you spend it.",
    points: [
      "Available limit = collateral × max LTV − debt",
      "Health gauge: Safe above 1.5x, Warning below 1.2x",
      "Stale or zero oracle prices are flagged, never guessed",
    ],
  },
  {
    icon: <CardIcon />,
    title: "Virtual card dashboard",
    what: "A 3D card plus the stats that matter, with simple controls.",
    points: [
      "Collateral locked, spendable yield, spent this month",
      "Net APY earned vs borrow rate",
      "Freeze / unfreeze toggle",
      "Monthly spending limit slider",
    ],
  },
  {
    icon: <Gift />,
    title: "Spend center",
    what: "Turn yield into real-world value without selling your principal.",
    points: [
      "Gift vouchers (Swiggy, Zomato, Amazon, Uber, Netflix) via Bitrefill",
      "Bank / UPI cashout via a non-custodial off-ramp widget",
      "One-tap “Repay using accrued yield”",
    ],
  },
];

const NOT_V1 = [
  "Our own smart contracts, tokens or yield strategies",
  "Any backend, database or user accounts",
  "Custody of funds, or KYC collected by us",
  "A native mobile app",
  "Chains beyond Arbitrum, Base and Scroll",
];

export default function FeaturesPage() {
  return (
    <PageShell
      eyebrow="Features"
      title="Everything in the first version."
      intro="Five things, done well. Try the live demos first, then read what each one actually does."
      next={{ href: "/security", label: "Security" }}
    >
      <Block title="Try it" lead="These demos run right in your browser. Numbers shown are examples.">
        <BentoGrid />
      </Block>

      <Block title="What each feature does">
        <div className="space-y-5">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title}>
              <div className="glass grid gap-6 rounded-3xl p-6 sm:p-8 md:grid-cols-[1fr_1.1fr]">
                <div>
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-cyan/10 text-2xl text-cyan">{f.icon}</span>
                  <p className="mt-5 font-mono text-xs uppercase tracking-widest text-muted">Feature {i + 1}</p>
                  <h3 className="mt-1 text-2xl font-bold tracking-tight">{f.title}</h3>
                  <p className="mt-3 text-muted">{f.what}</p>
                </div>
                <ul className="space-y-3 self-center">
                  {f.points.map((p) => (
                    <li key={p} className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald/15 text-emerald">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-fg/90">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </Block>

      <Block title="Not in version 1" lead="Saying no keeps the product small, safe and shippable.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {NOT_V1.map((n) => (
            <li key={n} className="glass flex items-center gap-3 rounded-2xl p-4 text-muted">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/5 text-sm">
                <Bank className="opacity-60" />
              </span>
              {n}
            </li>
          ))}
        </ul>
      </Block>
    </PageShell>
  );
}
