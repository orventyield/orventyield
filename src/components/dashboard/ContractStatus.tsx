"use client";

import { useChainId } from "wagmi";
import { ETHERFI_REGISTRY, type VerifyStatus } from "@/lib/contracts/etherfi";
import { LOCAL_FORK_CHAIN_ID } from "@/lib/wagmi";

const BADGE: Record<VerifyStatus, string> = {
  verified: "border-emerald/30 bg-emerald/10 text-emerald",
  unverified: "border-amber/30 bg-amber/10 text-amber",
  "no-code": "border-danger/30 bg-danger/10 text-danger",
};

/** Honest view of which Ether.fi addresses are confirmed on-chain, and why the app runs as a sandbox. */
export function ContractStatus() {
  const connected = useChainId();
  // The local fork mirrors Arbitrum One.
  const chainId = connected === LOCAL_FORK_CHAIN_ID ? 42161 : connected;
  const reg = ETHERFI_REGISTRY[chainId];
  const rows = reg ? Object.entries(reg.contracts) : [];

  return (
    <details data-testid="contract-status" className="bg-surface border border-white/5 rounded-2xl p-5 text-xs">
      <summary className="cursor-pointer font-bold text-fg text-sm">
        On-chain integration status{reg ? ` · ${reg.name}` : ""}
      </summary>
      <p className="mt-3 text-muted">
        Spend, borrow and repay run in the sandbox because the Ether.fi CashModule and DebtManager addresses are not
        yet confirmed on-chain. Only verified addresses are ever used for real calls.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 font-mono text-muted">No registry entries for this network yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(([name, c]) => (
            <li key={name} className="rounded-xl border border-white/5 bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold text-fg">{name}</span>
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${BADGE[c.status]}`}>{c.status}</span>
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-muted/80">{c.address}</div>
              <div className="mt-1 text-[11px] text-muted/70">{c.note}</div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
