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
  ["Fake or wrong addresses", "Every contract address comes from one config file with a link to Ether.fi's official source. Unverified entries stay empty rather than guessed."],
  ["Misleading numbers", "No invented APY, limit or health values. Stale or zero oracle prices are flagged on screen."],
  ["Malicious third-party code", "Voucher and off-ramp widgets run in sandboxed frames with no access to your wallet, behind a strict content security policy."],
  ["Leaked secrets", "There are no private keys or server secrets to leak. Public configuration only, and nothing sensitive in the repository."],
  ["Vulnerable dependencies", "Lockfile committed, dependencies audited before each release, and every change that touches the chain gets a security review."],
];

const RISKS = [
  ["Liquidation", "If your collateral falls in value, your position can be liquidated. Keep your health factor comfortably above 1.5x."],
  ["Smart-contract risk", "Ether.fi's contracts are battle-tested but not risk-free. Bugs can cause loss of funds."],
  ["Oracle risk", "Prices come from oracles. Wrong or delayed prices can affect limits and liquidations."],
  ["Third-party services", "Card, voucher and off-ramp providers have their own terms, fees, availability and KYC requirements."],
  ["Regulation & tax", "Rules differ by country. You are responsible for yours. Nothing here is legal or tax advice."],
];

const CHECKLIST = [
  "Check the URL before connecting your wallet.",
  "Read the transaction in your wallet. It should match what the app showed.",
  "Start with a small amount the first time.",
  "Never share your seed phrase. We will never ask.",
  "Keep health factor above 1.5x and repay early if prices drop.",
  "Revoke approvals you no longer need.",
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Security"
      title="Less surface area. More peace of mind."
      intro="The safest thing we can do is hold nothing. Here is how that works, how the app is designed to handle the rest, and the risks that still remain with you."
      next={{ href: "/faq", label: "FAQ" }}
    >
      <Block width="max-w-6xl">
        <TrustBody />
      </Block>

      <Block title="What could go wrong, and how the app is designed to handle it">
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

      <Block title="Risks that remain with you" lead="No interface can remove these. Know them before you deposit.">
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
            OrventYield is independent and not affiliated with or endorsed by Ether.fi. Crypto and borrowing involve risk,
            including loss of funds.
          </Notice>
        </div>
      </Block>
    </PageShell>
  );
}
