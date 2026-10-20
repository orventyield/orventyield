"use client";

interface Props {
  onVouchers: () => void;
  onCashout: () => void;
}

/** The two ways to spend earned yield today, one tap away from the overview. */
export function SpendShortcuts({ onVouchers, onCashout }: Props) {
  const tile = "flex min-h-16 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition-colors hover:border-cyan/40 hover:bg-white/[0.07]";
  return (
    <section aria-label="Spend your yield" data-testid="spend-shortcuts" className="glass-card rounded-2xl p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-muted">Spend your yield</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" data-testid="spend-vouchers" onClick={onVouchers} className={tile}>
          <span aria-hidden="true" className="text-2xl">🎁</span>
          <span>
            <span className="block text-sm font-semibold text-fg">Gift vouchers</span>
            <span className="block text-xs text-muted">Amazon, Uber, Swiggy, Zomato and more</span>
          </span>
        </button>
        <button type="button" data-testid="spend-cashout" onClick={onCashout} className={tile}>
          <span aria-hidden="true" className="text-2xl">🏦</span>
          <span>
            <span className="block text-sm font-semibold text-fg">Bank / UPI</span>
            <span className="block text-xs text-muted">Cash out earned yield to your account</span>
          </span>
        </button>
      </div>
    </section>
  );
}
