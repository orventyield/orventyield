import type { Metadata } from "next";
import { FaqList } from "@/components/landing/Faq";
import { Block, PageShell } from "@/components/pages/PageShell";

export const metadata: Metadata = {
  title: "FAQ · OrventYield",
  description: "Straight answers about custody, risk, cost, chains and status.",
};

const GROUPS: { title: string; items: { q: string; a: string }[] }[] = [
  {
    title: "The basics",
    items: [
      { q: "What is OrventYield?", a: "A non-custodial yield neobank. You deposit USDC into your own Safe, it earns yield on Aave v3, and you spend only that yield through vouchers, cashout or a virtual card. Your principal stays locked." },
      { q: "When can I use it?", a: "OrventYield is in testing on Arbitrum One. Try the Playground now; the live account opens as the card and spending rails go through production approval." },
      { q: "Is this affiliated with Safe, Aave or Immersve?", a: "No. OrventYield is independent. It uses the audited Safe smart account and Aave v3 contracts as they are, and deploys no contracts of its own. Safe, Aave and Immersve have not endorsed it." },
    ],
  },
  {
    title: "Safety & custody",
    items: [
      { q: "Is OrventYield custodial?", a: "No. Your assets live in your own Safe smart account and you sign every transaction from your own wallet. We hold no keys and no funds." },
      { q: "What if the site goes down?", a: "Your funds are in your Safe on-chain, not on our servers. You can still interact with the contracts through other interfaces." },
      { q: "Do you ever ask for my seed phrase?", a: "Never. If anything asks for it, it is not us." },
      { q: "What are the risks?", a: "Variable and non-guaranteed yield, smart-contract risk in Safe and Aave, stablecoin (USDC) risk, and third-party service risk. See the Security page for the full list. Nothing here is financial advice." },
    ],
  },
  {
    title: "Money",
    items: [
      { q: "Do I need KYC?", a: "OrventYield never sees your ID documents. Activating the card needs one free wallet signature, no phone number and no SMS. The card issuer, Immersve, runs the identity check for the card, and voucher or cashout providers can have their own requirements." },
      { q: "What does it cost?", a: "The interface is free to use. You pay network gas, and any fees charged by Aave, the card issuer or other third-party providers. Exact figures will be shown before you sign." },
      { q: "Does spending touch my principal?", a: "No. Only accrued yield can be spent. Your principal stays in your Safe. Yield is variable and not guaranteed, and a bug or exploit in the underlying protocols could still cause loss of funds." },
    ],
  },
  {
    title: "Technical",
    items: [
      { q: "Which chains and assets?", a: "Starting on Arbitrum One with USDC, supplied to Aave v3. More assets and chains may follow." },
      { q: "Which wallets work?", a: "MetaMask, Rainbow, Coinbase Wallet and anything supporting WalletConnect." },
      { q: "Where do the numbers come from?", a: "Balances and yield are read live from Aave v3 and your Safe on-chain. Demos on this site use example values and are labelled as such." },
      { q: "Do you run a backend or database?", a: "Balances and positions live on-chain. The only server is a small one that brokers voucher and bank-cashout orders so provider keys stay off your browser. It holds no balances and no personal data." },
    ],
  },
];

export default function FaqPage() {
  return (
    <PageShell
      eyebrow="FAQ"
      title="Straight answers."
      intro="The questions people ask first, answered without the spin."
      next={{ href: "/how-it-works", label: "How it works" }}
    >
      {GROUPS.map((g) => (
        <Block key={g.title} width="max-w-3xl">
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-cyan">{g.title}</h2>
          <FaqList items={g.items} />
        </Block>
      ))}
    </PageShell>
  );
}
