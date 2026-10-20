import type { Metadata } from "next";
import { BentoGrid } from "@/components/landing/Bento";
import { Block, PageShell } from "@/components/pages/PageShell";
import { Bank, Bolt, CardIcon, Check, Gift, Layers } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/motion";

export const metadata: Metadata = {
  title: "Features · OrventYield",
  description: "Everything in the first version: onboarding, yield vault, virtual card and spend center.",
};

const FEATURES = [
  {
    icon: <Layers />,
    title: "Wallet & Safe onboarding",
    what: "Connect a wallet and get your own Safe smart account, created when you make your first deposit.",
    points: [
      "MetaMask, Rainbow, Coinbase Wallet, WalletConnect",
      "Your Safe address is known before it is deployed",
      "Deployed through the canonical Safe v1.4.1 factory",
      "Clear wrong-network handling",
    ],
  },
  {
    icon: <Bolt />,
    title: "Yield vault & live yield",
    what: "Deposit USDC and watch your yield accrue in real time, with the numbers read straight from the contracts.",
    points: [
      "USDC supplied to Aave v3 from your own Safe",
      "Exact-amount approvals, never unlimited",
      "Live APY from the contracts",
      "Ticking counter of accrued yield",
    ],
  },
  {
    icon: <Check />,
    title: "Principal lock & spendable yield",
    what: "See exactly what you can spend, and know your principal is not part of it.",
    points: [
      "Spendable = aUSDC balance − principal, read on-chain",
      "Only earned yield can be withdrawn through the spend flow",
      "Your principal can always be withdrawn by you alone",
    ],
  },
  {
    icon: <CardIcon />,
    title: "Virtual card dashboard",
    what: "A 3D card plus the stats that matter, with simple controls.",
    points: [
      "Principal locked, spendable yield, live APY",
      "One free wallet signature, then the card issuer's identity check",
      "Card numbers revealed with a one-time link, hidden after 30 seconds",
      "Spend allowance equals your live yield",
    ],
  },
  {
    icon: <Gift />,
    title: "Spend center",
    what: "Turn yield into real-world value without selling your principal.",
    points: [
      "Gift vouchers (Swiggy, Zomato, Amazon, Uber, Netflix) via Bitrefill",
      "Bank / UPI cashout via a non-custodial off-ramp widget",
      "Everything is paid from earned yield, never from principal",
    ],
  },
];

const NOT_V1 = [
  "Our own smart contracts, tokens or yield strategies",
  "Any backend, database or user accounts",
  "Custody of funds, or KYC collected by us",
  "A native mobile app",
  "Chains beyond Arbitrum One",
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
