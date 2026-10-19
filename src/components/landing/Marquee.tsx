const ITEMS = [
  "Aave v3",
  "Safe",
  "Arbitrum",
  "USDC",
  "MetaMask",
  "Rainbow",
  "Coinbase Wallet",
  "WalletConnect",
  "Bitrefill",
  "UPI cashout",
];

export function Marquee() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <section id="proof" aria-label="Designed to work with" className="relative border-y border-line bg-surface/40 py-6">
      <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-[0.3em] text-muted">
        Designed to work with
      </p>
      <div className="[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] overflow-hidden">
        <ul className="flex w-max animate-marquee gap-12 pr-12 hover:[animation-play-state:paused]">
          {row.map((t, i) => (
            <li
              key={i}
              aria-hidden={i >= ITEMS.length}
              className="flex items-center gap-12 whitespace-nowrap text-lg font-semibold text-white/55 sm:text-xl"
            >
              {t}
              <span className="h-1.5 w-1.5 rounded-full bg-cyan/70" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
