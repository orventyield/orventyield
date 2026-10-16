import type { Metadata } from "next";
import { Bank, Bolt, CardIcon, Layers, Repeat, Wallet } from "@/components/ui/Icons";
import { Block, Notice, PageShell } from "@/components/pages/PageShell";
import { Reveal } from "@/components/ui/motion";

export const metadata: Metadata = {
  title: "How it works · OrventYield",
  description: "Exactly what happens at each step, what you sign, and who holds what.",
};

const IDEA = [
  {
    icon: <Layers />,
    title: "1. Collateral stays yours",
    body: "You deposit into a smart-contract Safe that only you control. Staked assets like weETH keep earning yield while they sit there.",
  },
  {
    icon: <CardIcon />,
    title: "2. The card borrows against it",
    body: "Spending draws on a credit line backed by your collateral, so you never have to sell. Your limit is collateral value × max LTV, minus what you already owe.",
  },
  {
    icon: <Repeat />,
    title: "3. Yield pays it back",
    body: "Accrued yield is used to repay what you spent, one tap at a time. Your principal is never the thing being spent.",
  },
];

const STEPS = [
  {
    icon: <Wallet />,
    title: "Connect your wallet",
    you: "Pick MetaMask, Rainbow, Coinbase Wallet or WalletConnect and approve the connection.",
    chain: "Nothing is sent on-chain. We only read your address and the network you are on.",
    see: "Your address, your network, and a prompt to switch if you are on an unsupported chain.",
  },
  {
    icon: <Layers />,
    title: "Create your Safe",
    you: "Approve one transaction to create your personal EtherFiSafe through Ether.fi's official factory.",
    chain: "A new smart-contract wallet is deployed for you. You are its owner, and we have no keys to it.",
    see: "Your Safe address. If you already have one, we find it and skip this step.",
  },
  {
    icon: <Bolt />,
    title: "Deposit and earn",
    you: "Choose ETH, WETH, weETH or USDC and an amount. Approve the exact amount, then deposit.",
    chain: "Tokens move into your Safe. Staked assets accrue yield natively; the APY is read from the contracts.",
    see: "Collateral value in USD, live APY, and a ticking counter of yield accrued.",
  },
  {
    icon: <CardIcon />,
    title: "Spend",
    you: "Use the virtual card, buy a voucher, or cash out to a bank or UPI through a third-party widget.",
    chain: "Spending creates debt against your collateral. Your available limit and health factor update.",
    see: "Available limit, total spent this month, and a health gauge with Safe / Warning / At-risk zones.",
  },
  {
    icon: <Repeat />,
    title: "Repay with yield",
    you: "Tap “Repay using accrued yield” whenever you like.",
    chain: "Accrued yield is applied to your debt. Principal is untouched.",
    see: "Debt goes down, available limit goes up, health improves.",
  },
];

const HOLDS = [
  ["You", "Your wallet keys and the decision to sign every transaction."],
  ["Your Safe", "Your collateral and your debt position, controlled by you."],
  ["Ether.fi contracts", "The rules: limits, interest, prices and settlement. Already deployed and public."],
  ["OrventYield", "Nothing. We are only the interface, with no funds, keys, servers or database."],
];

const CONTRACTS = [
  ["EtherFiSafe", "Your own smart-contract wallet that holds collateral."],
  ["CashModule", "Handles card authorisation and settlement permissions."],
  ["DebtManager", "Tracks what you owe, interest rates and borrow limits."],
  ["weETH", "Liquid staked ETH that accrues staking yield."],
  ["PriceProvider", "Oracle prices used to value collateral and compute safety."],
];

export default function HowItWorksPage() {
  return (
    <PageShell
      eyebrow="How it works"
      title="From wallet to spending, step by step."
      intro="OrventYield is an interface on top of Ether.fi Cash. Here is exactly what happens at every step, what you sign, and who holds what."
      next={{ href: "/calculator", label: "Calculator" }}
    >
      <Block title="The big idea" lead="Three things happen in a loop. That is the whole product.">
        <div className="grid gap-4 md:grid-cols-3">
          {IDEA.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <div className="glass h-full rounded-3xl p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan/10 text-2xl text-cyan">{c.icon}</span>
                <h3 className="mt-5 text-lg font-bold">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Block>

      <Block title="Step by step" lead="What you do, what happens on-chain, and what you see.">
        <ol className="space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal>
                <div className="glass rounded-3xl p-6 sm:p-8">
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-cyan/50 font-mono text-lg font-bold text-cyan shadow-[0_0_24px_rgba(0,240,255,0.4)]">
                      {i + 1}
                    </span>
                    <h3 className="text-xl font-bold sm:text-2xl">{s.title}</h3>
                  </div>
                  <dl className="mt-6 grid gap-5 md:grid-cols-3">
                    {[
                      ["You do", s.you],
                      ["On-chain", s.chain],
                      ["You see", s.see],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="font-mono text-[11px] uppercase tracking-widest text-cyan">{k}</dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-muted sm:text-base">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </Block>

      <Block title="Who holds what" lead="The reason we can promise to be non-custodial.">
        <div className="overflow-hidden rounded-3xl border border-line">
          {HOLDS.map(([who, what], i) => (
            <div
              key={who}
              className={`grid gap-1 bg-surface p-5 sm:grid-cols-[200px_1fr] sm:gap-6 ${i ? "border-t border-line" : ""}`}
            >
              <p className={`font-bold ${who === "OrventYield" ? "text-cyan" : ""}`}>{who}</p>
              <p className="text-sm text-muted sm:text-base">{what}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Under the hood" lead="The existing Ether.fi contracts the app talks to. We deploy none of our own.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {CONTRACTS.map(([n, d]) => (
            <li key={n} className="glass flex items-start gap-3 rounded-2xl p-4">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-cyan">
                <Bank />
              </span>
              <div>
                <p className="font-mono text-sm font-bold text-fg">{n}</p>
                <p className="text-sm text-muted">{d}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <Notice>
            Status: we are still verifying contract addresses and the exact Safe-creation flow against Ether.fi&rsquo;s
            official documentation. This page describes the intended flow and will be updated if anything differs.
          </Notice>
        </div>
      </Block>
    </PageShell>
  );
}
