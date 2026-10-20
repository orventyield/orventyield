import type { Metadata } from "next";
import { Bank, Bolt, CardIcon, Layers, Repeat, Wallet } from "@/components/ui/Icons";
import { Block, PageShell } from "@/components/pages/PageShell";
import { Reveal } from "@/components/ui/motion";

export const metadata: Metadata = {
  title: "How it works · OrventYield",
  description: "Exactly what happens at each step, what you sign, and who holds what.",
};

const IDEA = [
  {
    icon: <Layers />,
    title: "1. Principal stays yours",
    body: "You deposit USDC into a smart-contract Safe that only you control. It is supplied to Aave v3, where it earns yield while it sits there.",
  },
  {
    icon: <CardIcon />,
    title: "2. Spend only the yield",
    body: "Vouchers, cashout and the virtual card are paid from earned yield only. Your spend allowance is your aUSDC balance minus your principal.",
  },
  {
    icon: <Repeat />,
    title: "3. Yield refills it",
    body: "Aave keeps paying yield every second, so your spendable amount grows back on its own. Your principal is never the thing being spent.",
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
    you: "Approve one transaction to create your personal Safe through the canonical Safe v1.4.1 factory.",
    chain: "A new smart-contract wallet is deployed for you. You are its owner, and we have no keys to it.",
    see: "Your Safe address, which is known before it is created.",
  },
  {
    icon: <Bolt />,
    title: "Deposit and earn",
    you: "Enter a USDC amount. Approve exactly that amount, then deposit.",
    chain: "Your USDC is supplied to the Aave v3 Pool on behalf of your Safe. The APY is read from Aave.",
    see: "Principal, live APY, and a ticking counter of yield accrued.",
  },
  {
    icon: <CardIcon />,
    title: "Spend",
    you: "Withdraw yield to spend it, buy a voucher, cash out to a bank or UPI, or use the virtual card.",
    chain: "Your Safe withdraws only the yield from Aave. The contract refuses to give back more than the balance.",
    see: "Spendable yield, principal unchanged, and a transaction link for every step.",
  },
  {
    icon: <Repeat />,
    title: "Yield refills",
    you: "Nothing. Come back whenever you want to spend again.",
    chain: "Aave keeps accruing yield on your principal every second.",
    see: "Your spendable yield ticking up again.",
  },
];

const HOLDS = [
  ["You", "Your wallet keys and the decision to sign every transaction."],
  ["Your Safe", "Your principal and your Aave position, controlled by you."],
  ["Aave v3", "The rules: yield rates, prices and withdrawals. Set by the Aave protocol, not by us."],
  ["OrventYield", "Nothing of yours. We are only the interface: no funds, no keys. A small server only brokers voucher and bank-cashout orders, so provider keys never reach your browser."],
];

const CONTRACTS = [
  ["Safe v1.4.1", "Your own smart-contract wallet that holds your funds."],
  ["Aave Pool", "Where your USDC is supplied to earn yield."],
  ["aUSDC", "A receipt token whose balance grows as yield accrues."],
  ["USDC", "The stablecoin you deposit and earn on."],
];

export default function HowItWorksPage() {
  return (
    <PageShell
      eyebrow="How it works"
      title="From wallet to spending, step by step."
      intro="OrventYield is an interface on top of Safe and Aave. Here is exactly what happens at every step, what you sign, and who holds what."
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

      <Block title="Under the hood" lead="The existing Safe and Aave contracts the app talks to. We deploy none of our own.">
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
      </Block>
    </PageShell>
  );
}
