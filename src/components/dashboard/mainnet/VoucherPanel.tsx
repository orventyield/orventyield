"use client";

import { useEffect, useState } from "react";
import { TxSteps } from "@/components/dashboard/mainnet/TxSteps";
import type { TxStep } from "@/features/account/useSafeAccount";
import { useVoucherShop, VOUCHER_COUNTRIES, type PastVoucher } from "@/features/vouchers/useVoucherShop";
import { fmtUsdc } from "@/lib/aave/format";
import { BRANDS, validValue } from "@/lib/vouchers/brands";
import type { BrandId, VoucherProduct } from "@/lib/vouchers/types";

type Shop = ReturnType<typeof useVoucherShop>;

interface Props {
  shop: Shop;
  maxYield: bigint;
  tickingYield: bigint;
  busy: boolean;
  txError: string | null;
  steps: TxStep[];
  explorer?: string;
}

const META: Record<BrandId, { icon: string; category: string }> = {
  amazon: { icon: "📦", category: "Shopping" },
  flipkart: { icon: "🛍️", category: "Shopping" },
  uber: { icon: "🚗", category: "Ride & Food" },
  swiggy: { icon: "🍔", category: "Food Delivery" },
  zomato: { icon: "🍽️", category: "Food Delivery" },
};

const money = (n: number, cur: string) => `${cur ? `${cur} ` : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const buy = "w-full rounded-xl bg-cyan py-3 text-xs font-bold uppercase tracking-wider text-bg shadow-lg shadow-cyan/25 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="min-h-11 rounded bg-white/10 px-2.5 py-1 text-xs text-fg transition-colors hover:bg-white/20"
    >
      {done ? "Copied!" : "Copy"}
    </button>
  );
}

/** The Mainnet twin of the Playground's VoucherCenter: same store layout, but real vouchers paid from real yield. */
export function VoucherPanel({ shop, maxYield, tickingYield, busy, txError, steps, explorer }: Props) {
  const [picked, setPicked] = useState<VoucherProduct | null>(null);
  const [packageId, setPackageId] = useState<string | number | null>(null);
  const [custom, setCustom] = useState("");
  const p = shop.purchase;

  useEffect(() => {
    setPicked(null);
    setPackageId(null);
    setCustom("");
  }, [shop.country]);

  if (shop.unavailable) {
    return (
      <div data-testid="voucher-unavailable" className="space-y-3 rounded-2xl glass-card p-6 text-center">
        <h3 className="text-base font-bold text-fg">Digital Voucher Store</h3>
        <p role="status" className="mx-auto max-w-md text-sm text-muted">The voucher store is temporarily unavailable. Nothing was charged and your yield keeps growing. Please try again shortly.</p>
        <button type="button" data-testid="voucher-retry" onClick={() => void shop.reloadCatalog()} className="min-h-11 rounded-xl border border-white/10 px-5 text-sm font-semibold text-fg hover:bg-white/5">
          Try again
        </button>
      </div>
    );
  }

  if (!shop.configured) {
    return (
      <div data-testid="voucher-unconfigured" className="space-y-2 rounded-2xl glass-card p-6 text-center">
        <h3 className="text-base font-bold text-fg">Digital Voucher Store</h3>
        <p className="text-sm text-muted">The voucher store is temporarily unavailable. Please try again shortly.</p>
      </div>
    );
  }

  const choice = ((): { sel: { packageId: string | number } | { value: number } | null; label: string } => {
    if (!picked) return { sel: null, label: "" };
    if (custom) {
      const v = Number(custom);
      return validValue(picked, v) ? { sel: { value: v }, label: money(v, picked.currency) } : { sel: null, label: "" };
    }
    const k = picked.packages.find((x) => x.id === packageId);
    return k ? { sel: { packageId: k.id }, label: money(k.value, picked.currency) } : { sel: null, label: "" };
  })();
  const customInvalid = custom !== "" && picked !== null && !validValue(picked, Number(custom));
  const idle = p.stage === "idle" || p.stage === "quoting";

  return (
    <div className="space-y-6 rounded-2xl glass-card p-5" data-testid="voucher-panel">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-fg">
            Digital Voucher Store
            <span className="rounded-full border border-emerald/20 bg-emerald/10 px-2 py-0.5 font-mono text-xs text-emerald">Bitrefill</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">Buy digital gift cards with the yield you have earned. Your principal is never used.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.05] px-3 py-1.5 font-mono text-xs">
            <span className="text-muted">Available Yield:</span>
            <span data-testid="voucher-yield" className="font-bold text-emerald">${fmtUsdc(tickingYield)}</span>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.05] px-2 font-mono text-xs text-muted">
            Country
            <select data-testid="voucher-country" value={shop.country} onChange={(e) => shop.setCountry(e.target.value as (typeof VOUCHER_COUNTRIES)[number])} className="min-h-11 bg-transparent text-fg outline-none">
              {VOUCHER_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Catalog grid */}
      {shop.catalogError && (
        <div role="alert" data-testid="voucher-catalog-error" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {shop.catalogError} <button type="button" onClick={() => void shop.reloadCatalog()} className="ml-2 underline">Try again</button>
        </div>
      )}
      {!shop.catalogError && shop.products === null && <div data-testid="voucher-loading" aria-busy="true" className="h-28 animate-pulse rounded-2xl bg-white/[0.05]" />}
      {shop.products && shop.products.length === 0 && (
        <p data-testid="voucher-empty" className="rounded-xl border border-white/5 bg-white/[0.05] p-6 text-center text-sm text-muted">No vouchers are available for {shop.country} right now. Try another country.</p>
      )}
      {shop.products && shop.products.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {shop.products.map((pr) => {
            const label = BRANDS.find((b) => b.id === pr.brand)!.label;
            const on = picked?.productId === pr.productId;
            const from = pr.packages[0] ? money(pr.packages[0].value, pr.currency) : pr.range ? money(pr.range.min, pr.currency) : "";
            return (
              <button
                key={pr.productId}
                type="button"
                data-testid={`brand-${pr.brand}`}
                aria-pressed={on}
                disabled={!idle}
                onClick={() => {
                  setPicked(pr);
                  setPackageId(pr.packages[0]?.id ?? null);
                  setCustom("");
                }}
                className={`flex flex-col justify-between rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${on ? "border-cyan/40 bg-cyan/10 text-fg shadow-sm shadow-cyan/20" : "border-white/5 bg-white/[0.05] text-muted hover:border-white/10 hover:text-fg"}`}
              >
                <div>
                  <span className="mb-2 block text-2xl">{META[pr.brand].icon}</span>
                  <div className="line-clamp-1 text-xs font-bold">{label}</div>
                  <div className="text-[10px] text-muted/70">{META[pr.brand].category}</div>
                </div>
                <div className="mt-3 font-mono text-[11px] text-cyan">{from ? `From ${from}` : pr.currency}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Configuration & purchase */}
      <div className="grid grid-cols-1 items-start gap-5 rounded-2xl border border-white/10 bg-[#090b10] p-5 md:grid-cols-12">
        <div data-testid="voucher-chooser" className="space-y-3 md:col-span-6">
          <span className="block font-mono text-xs uppercase tracking-wider text-muted">{picked ? `Choose amount for ${picked.name}` : "Choose a brand above"}</span>
          {picked && picked.packages.length > 0 && (
            <div role="group" aria-label="Amount" className="flex flex-wrap gap-2">
              {picked.packages.map((k) => {
                const on = !custom && packageId === k.id;
                return (
                  <button key={k.id} type="button" data-testid={`pkg-${k.id}`} aria-pressed={on} disabled={!idle} onClick={() => { setPackageId(k.id); setCustom(""); }} className={`min-h-11 rounded-xl px-4 py-2 font-mono text-xs font-bold transition-all ${on ? "bg-cyan text-bg shadow-sm shadow-cyan/40" : "border border-white/10 bg-white/[0.05] text-muted hover:text-fg"}`}>
                    {money(k.value, picked.currency)}
                  </button>
                );
              })}
            </div>
          )}
          {picked?.range && (
            <div>
              <label htmlFor="v-custom" className="text-[11px] text-muted">Or type an amount ({money(picked.range.min, picked.currency)} to {money(picked.range.max, picked.currency)})</label>
              <input id="v-custom" data-testid="voucher-custom" inputMode="decimal" disabled={!idle} value={custom} onChange={(e) => setCustom(e.target.value)} aria-invalid={customInvalid} className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 font-mono text-sm text-fg outline-none focus:border-cyan" />
              {customInvalid && <p role="alert" className="mt-1 text-[11px] text-danger">That amount isn&rsquo;t available for this voucher.</p>}
            </div>
          )}
          <div className="pt-2">
            <span className="mb-1.5 block font-mono text-[11px] text-muted">Funding Source:</span>
            <div className="rounded-xl border border-emerald/40 bg-emerald/15 p-2.5 text-xs font-medium text-emerald">
              <div className="font-bold">⚡ Fund with Earned Yield</div>
              <div className="mt-0.5 text-[10px] opacity-80">$0 borrowed · principal untouched</div>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.05] p-4 md:col-span-6">
          {idle && (
            <>
              <div className="flex justify-between font-mono text-xs"><span className="text-muted">Item:</span><span className="font-semibold text-fg">{picked ? picked.name : "—"}</span></div>
              <div className="flex justify-between font-mono text-xs"><span className="text-muted">Face value:</span><span className="font-bold text-fg">{choice.label || "—"}</span></div>
              <button type="button" data-testid="voucher-price" disabled={!picked || !choice.sel || p.stage === "quoting"} onClick={() => picked && choice.sel && void shop.quote(picked, choice.sel)} className={buy}>
                {p.stage === "quoting" ? "Getting your price…" : "Get exact price"}
              </button>
              <p className="text-center text-[10px] text-muted">Getting a price is free. Nothing is charged until you confirm.</p>
            </>
          )}

          {p.stage === "quoted" && picked && (
            <div data-testid="voucher-quote" className="space-y-3">
              <div className="flex justify-between font-mono text-xs"><span className="text-muted">Item:</span><span className="font-semibold text-fg">{picked.name} · {choice.label}</span></div>
              <div className="flex justify-between font-mono text-xs"><span className="text-muted">Total Due:</span><span data-testid="quote-price" className="text-base font-bold text-fg">{p.quote.price.toFixed(2)} USDC</span></div>
              <div className="flex justify-between font-mono text-[11px]"><span className="text-muted">Paid from</span><span className="text-emerald">your earned yield</span></div>
              <div className="flex justify-between font-mono text-[11px]"><span className="text-muted">Principal used</span><span className="text-fg">$0.00</span></div>
              <p className="text-[11px] text-muted">Your Safe withdraws exactly this much yield from Aave and sends it to the voucher provider in one transaction. Pay soon: the price is only held for a short time.</p>
              {!p.affordable && <p role="alert" data-testid="quote-short" className="rounded-lg border border-amber/30 bg-amber/10 p-2.5 font-mono text-xs text-amber">You have ${fmtUsdc(maxYield)} of yield and this costs {p.quote.price.toFixed(2)}. Only earned yield can be spent, so wait for more yield or pick a smaller voucher.</p>}
              {txError && <p role="alert" data-testid="voucher-tx-error" className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 font-mono text-xs text-danger">{txError}</p>}
              <button type="button" data-testid="voucher-pay" disabled={!p.affordable || busy} onClick={() => void shop.payAndDeliver(picked, choice.label)} className={buy}>Pay {p.quote.price.toFixed(2)} USDC from yield</button>
              <button type="button" onClick={shop.reset} className="min-h-11 w-full rounded-xl border border-white/10 text-xs font-semibold text-fg hover:bg-white/5">Cancel</button>
            </div>
          )}

          {p.stage === "paying" && (
            <div data-testid="voucher-paying" aria-live="polite" className="text-sm text-muted">
              <p className="font-semibold text-fg">Confirm in your wallet…</p>
              <p className="mt-1 text-xs">Your Safe is paying {p.quote.price.toFixed(2)} USDC from yield.</p>
              <div className="mt-3"><TxSteps steps={steps} explorer={explorer} /></div>
            </div>
          )}

          {p.stage === "delivering" && (
            <div data-testid="voucher-delivering" aria-live="polite" className="text-sm text-muted">
              <p className="font-semibold text-fg"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" />Paid. Waiting for your voucher…</p>
              <p className="mt-1 font-mono text-xs">Reference {p.quote.invoiceId}. This usually takes under a minute.</p>
            </div>
          )}

          {p.stage === "delivered" && (
            <div data-testid="voucher-delivered" className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs font-bold text-emerald"><span>YOUR VOUCHER IS READY</span><span>LIVE</span></div>
              {p.redemptions.length === 0 && <p className="text-xs text-muted">Delivered, but the provider sent no code. Reference {p.quote.invoiceId}.</p>}
              {p.redemptions.map((r, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-emerald/40 bg-black p-3.5">
                  {r.code && <div className="flex items-center justify-between rounded-lg bg-white/[0.05] px-3 py-2 font-mono text-sm font-bold text-cyan"><span data-testid="voucher-code">{r.code}</span><Copy text={r.code} label="code" /></div>}
                  {r.pin && <div className="flex items-center justify-between rounded-lg bg-white/[0.05] px-3 py-2 font-mono text-sm text-fg"><span>PIN <span data-testid="voucher-pin">{r.pin}</span></span><Copy text={r.pin} label="PIN" /></div>}
                  {r.link && /^https:\/\//.test(r.link) && <a data-testid="voucher-link" href={r.link} target="_blank" rel="noopener noreferrer" className="block text-xs text-cyan hover:underline">Open redemption page ↗</a>}
                  {r.instructions && <p className="text-[11px] leading-relaxed text-muted">{r.instructions}</p>}
                  {r.expirationDate && <p className="font-mono text-[10px] text-muted">Expires {r.expirationDate}</p>}
                </div>
              ))}
              <p className="text-[10px] text-muted">We don&rsquo;t store your code. Save it now; you can fetch it again from &ldquo;Your vouchers&rdquo; below.</p>
              <button type="button" data-testid="voucher-done" onClick={shop.reset} className="min-h-11 w-full rounded-xl border border-white/10 text-xs font-semibold text-fg hover:bg-white/5">Done</button>
            </div>
          )}

          {p.stage === "failed" && (
            <div role="alert" data-testid="voucher-failed" className="space-y-3 text-sm text-danger">
              <p>{p.message}</p>
              <button type="button" onClick={shop.reset} className="min-h-11 rounded-xl border border-white/10 px-5 text-xs font-semibold text-fg hover:bg-white/5">Back</button>
            </div>
          )}
        </div>
      </div>

      {shop.history.length > 0 && p.stage === "idle" && (
        <div data-testid="voucher-history" className="rounded-xl border border-white/5 bg-white/[0.05] p-4">
          <h4 className="text-sm font-bold text-fg">Your vouchers</h4>
          <ul className="mt-2 divide-y divide-white/5">
            {shop.history.map((h: PastVoucher) => (
              <li key={h.invoiceId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-fg">{h.brand} <span className="font-mono text-xs text-muted">{h.face} · {h.priceUsdc.toFixed(2)} USDC · {new Date(h.at).toLocaleDateString()}</span></span>
                <button type="button" onClick={() => void shop.reopen(h)} className="min-h-11 shrink-0 rounded-lg border border-white/10 px-3 text-xs font-semibold text-cyan hover:bg-white/5">Show code</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

