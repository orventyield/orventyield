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
      { q: "What is OrventYield?", a: "A web interface for Ether.fi Cash. You deposit collateral, watch yield accrue, and spend through a virtual card, vouchers or cashout, while repaying with yield instead of selling your principal." },
      { q: "Is it live?", a: "Not yet. The pages show the product we are building, and numbers in demos are illustrative. Early access is opening soon." },
      { q: "Is this affiliated with Ether.fi?", a: "No. OrventYield is independent and connects to Ether.fi's publicly deployed contracts. Ether.fi has not endorsed it." },
    ],
  },
  {
    title: "Safety & custody",
    items: [
      { q: "Is OrventYield custodial?", a: "No. It is a front-end only. Your assets live in your own Ether.fi Safe and you sign every transaction from your own wallet." },
      { q: "What if the site goes down?", a: "Your funds are in your Safe on-chain, not on our servers. You can still interact with the contracts through other interfaces." },
      { q: "Do you ever ask for my seed phrase?", a: "Never. If anything asks for it, it is not us." },
      { q: "What are the risks?", a: "Liquidation if collateral falls, smart-contract and oracle risk, and third-party service risk. See the Security page for the full list. Nothing here is financial advice." },
    ],
  },
  {
    title: "Money",
    items: [
      { q: "Do I need KYC?", a: "OrventYield does not collect KYC or run accounts. Third-party services you use through it, such as card issuers, voucher stores or off-ramps, can have their own requirements." },
      { q: "What does it cost?", a: "The interface is free to use. You pay network gas, and any fees or interest charged by Ether.fi or third-party providers. Exact figures will be shown before you sign." },
      { q: "Does spending touch my principal?", a: "Spending draws on a credit line backed by your collateral, and accrued yield repays it. The aim is to keep your principal intact, but if your position is liquidated, collateral can be lost." },
    ],
  },
  {
    title: "Technical",
    items: [
      { q: "Which chains and assets?", a: "Planned for Arbitrum, Base and Scroll, where Ether.fi Cash is active. Collateral: ETH, WETH, weETH and USDC." },
      { q: "Which wallets work?", a: "MetaMask, Rainbow, Coinbase Wallet and anything supporting WalletConnect." },
      { q: "Where do the numbers come from?", a: "APY, prices, limits and debt are read live from Ether.fi's contracts. Demos on this site use illustrative values and are labelled as such." },
      { q: "Do you run a backend or database?", a: "No. State lives on-chain and the site is static, which is also why running it costs nothing." },
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
