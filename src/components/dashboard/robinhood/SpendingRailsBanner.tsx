"use client";

/** Non-blocking notice on the spending tabs while Robinhood Chain (USDG) is selected: spending runs on Arbitrum One (USDC). */
export function SpendingRailsBanner({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div data-testid="spending-rails-banner" role="status" className="flex flex-col gap-3 rounded-xl border border-cyan/25 bg-cyan/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-fg">Spending rails (Vouchers, Card, Bank) operate on Arbitrum One (USDC). Switch network to access spending.</p>
      <button type="button" data-testid="switch-to-arbitrum" onClick={onSwitch} className="min-h-11 shrink-0 rounded-xl bg-cyan px-5 text-sm font-semibold text-bg shadow-[0_0_24px_rgba(0,240,255,0.3)] hover:brightness-110">
        Switch to Arbitrum One
      </button>
    </div>
  );
}
