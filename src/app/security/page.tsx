import type { Metadata } from "next";
import { TrustBody } from "@/components/landing/Trust";
import { Block, Notice, PageShell } from "@/components/pages/PageShell";
import { Check } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/motion";

export const metadata: Metadata = {
  title: "Security · OrventYield",
  description: "How we reduce risk, what risks remain, and how to stay safe.",
};

const THREATS = [
  ["Signing the wrong thing", "Every write is simulated first, and you see the contract, function, amount and chain before signing. Approvals are exact-amount only."],
  ["Fake or wrong addresses", "Every contract address comes from a single configuration file and is checked against the official Safe and Aave deployment lists. The app only ever talks to those addresses, never to anything a user or a link supplies."],
  ["Misleading numbers", "No invented APY or balance. Yield and balances are read from Aave and your Safe on-chain, and demos are labelled as examples."],
  ["Malicious third-party code", "Voucher and off-ramp widgets run in sandboxed frames with no access to your wallet, behind a strict content security policy."],
  ["Leaked secrets", "There are no private keys or server secrets to leak. Public configuration only, and nothing sensitive in the repository."],
  ["Vulnerable dependencies", "Dependencies are locked and checked on every release, and every change that touches the chain goes through a dedicated security review."],
];

const RISKS = [
  ["Variable yield", "Aave's rate moves with market demand and can fall to near zero. Yield is never guaranteed."],
  ["Smart-contract risk", "Safe and Aave contracts are battle-tested and audited, but not risk-free. Bugs can cause loss of funds."],
  ["Stablecoin risk", "USDC is a stablecoin issued by Circle. If it loses its peg or is frozen, your balance can lose value or become hard to move."],
  ["Third-party services", "Card, voucher and off-ramp providers have their own terms, fees, availability and KYC requirements."],
  ["Regulation & tax", "Rules differ by country. You are responsible for yours. Nothing here is legal or tax advice."],
];

const CHECKLIST = [
  "Check the URL before connecting your wallet.",
  "Read the transaction in your wallet. It should match what the app showed.",
  "Start with a small amount the first time.",
  "Never share your seed phrase. We will never ask.",
  "Only spend the yield. Your principal is meant to stay in Aave.",
  "Revoke approvals you no longer need.",
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Security"
      title="Less surface area. More peace of mind."
      intro="The safest way to protect your funds is to never hold them. Here is how OrventYield keeps you in control, the safeguards built into every transaction, and the risks you should always know about."
      next={{ href: "/faq", label: "FAQ" }}
    >
      <Block width="max-w-6xl">
        <TrustBody />
      </Block>

      <Block title="How we protect you">
        <div className="grid gap-4 md:grid-cols-2">
          {THREATS.map(([t, d], i) => (
            <Reveal key={t} delay={(i % 2) * 0.08}>
              <div className="glass h-full rounded-2xl p-6">
                <h3 className="font-bold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Block>

      <Block title="Risks to know about" lead="No interface can remove these. Know them before you deposit.">
        <div className="overflow-hidden rounded-3xl border border-line">
          {RISKS.map(([r, d], i) => (
            <div key={r} className={`grid gap-1 bg-surface p-5 sm:grid-cols-[220px_1fr] sm:gap-6 ${i ? "border-t border-line" : ""}`}>
              <p className="font-bold text-amber">{r}</p>
              <p className="text-sm text-muted sm:text-base">{d}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Your safety checklist">
        <ul className="grid gap-3 sm:grid-cols-2">
          {CHECKLIST.map((c) => (
            <li key={c} className="glass flex items-start gap-3 rounded-2xl p-4">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald/15 text-emerald">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="text-fg/90">{c}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <Notice tone="warn">
            OrventYield is independent and not affiliated with or endorsed by Safe, Aave or Immersve. Crypto involves risk,
            including loss of funds.
          </Notice>
        </div>
      </Block>
    </PageShell>
  );
}
