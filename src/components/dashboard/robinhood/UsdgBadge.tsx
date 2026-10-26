/**
 * An unmistakable USDG badge. Deliberately NOT the blue USDC look used on Arbitrum, so the two assets are never mixed up.
 * Generic mark (not Paxos' official artwork): a teal coin with "USDG" and the issuer's name beside it.
 */
export function UsdgBadge({ withIssuer = true }: { withIssuer?: boolean }) {
  return (
    <span data-testid="usdg-badge" className="inline-flex items-center gap-2 rounded-full border border-emerald/30 bg-emerald/10 py-1 pl-1 pr-3 text-xs font-semibold text-emerald">
      <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-emerald to-teal-400 text-[11px] font-black text-bg">G</span>
      USDG
      {withIssuer && <span className="font-normal text-emerald/70">· Paxos Global Dollar</span>}
    </span>
  );
}
