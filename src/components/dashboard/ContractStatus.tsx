"use client";

import { ETHERFI_REGISTRY, ETHERFI_SOURCE, type VerifyStatus } from "@/lib/contracts/etherfi";

const BADGE: Record<VerifyStatus, string> = {
  verified: "border-emerald/30 bg-emerald/10 text-emerald",
  unverified: "border-amber/30 bg-amber/10 text-amber",
  "no-code": "border-danger/30 bg-danger/10 text-danger",
};

const ROLE: Record<string, string> = {
  cash: "Live Cash deployment",
  "legacy-cash": "Legacy deployment",
  "top-up-source": "Top-up source chain",
};

const EXPLORER: Record<number, string> = {
  10: "https://optimistic.etherscan.io/address/",
  42161: "https://arbiscan.io/address/",
  8453: "https://basescan.org/address/",
  534352: "https://scrollscan.com/address/",
};

const ORDER = [10, 42161, 8453, 534352];

/** Where Ether.fi Cash runs, and which addresses have been checked on-chain. */
export function ContractStatus() {
  return (
    <details data-testid="contract-status" className="rounded-2xl border border-white/5 bg-surface p-5 text-xs">
      <summary className="cursor-pointer text-sm font-bold text-fg">Ether.fi integration · contracts verified on-chain</summary>
      <p className="mt-3 text-muted">
        Ether.fi Cash runs on Optimism; Arbitrum and Base only take top-ups, and Scroll is a legacy deployment. Addresses come from Ether.fi&rsquo;s official repository (
        <a className="text-cyan hover:underline" href={`${ETHERFI_SOURCE.repo}/tree/${ETHERFI_SOURCE.commit}/deployments/mainnet`} target="_blank" rel="noopener noreferrer">
          commit {ETHERFI_SOURCE.commit.slice(0, 7)}
        </a>
        ) and checked against the chains. Card spends are authorized by Ether.fi&rsquo;s own role, so this app reads live state and asks the contracts for a verdict instead of sending transactions.
      </p>
      <div className="mt-4 space-y-5">
        {ORDER.map((id) => {
          const chain = ETHERFI_REGISTRY[id];
          if (!chain) return null;
          return (
            <section key={id} aria-label={chain.name}>
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-fg">{chain.name}</h3>
                <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-muted">{ROLE[chain.role]}</span>
              </div>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {Object.entries(chain.contracts).map(([name, c]) => (
                  <li key={name} className="rounded-xl border border-white/5 bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-fg">{name}</span>
                      <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${BADGE[c.status]}`}>{c.status}</span>
                    </div>
                    <a href={`${EXPLORER[id]}${c.address}`} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all font-mono text-[11px] text-cyan/80 hover:underline">
                      {c.address}
                    </a>
                    <p className="mt-1 text-[11px] leading-snug text-muted/70">{c.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
