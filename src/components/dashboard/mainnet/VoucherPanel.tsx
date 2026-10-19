"use client";

import { useEffect, useState } from "react";
import { useVoucherShop, VOUCHER_COUNTRIES, type PastVoucher } from "@/features/vouchers/useVoucherShop";
import { fmtUsdc } from "@/lib/aave/format";
import { BRANDS, validValue } from "@/lib/vouchers/brands";
import type { VoucherProduct } from "@/lib/vouchers/types";
import type { Address } from "viem";
import { TxSteps } from "@/components/dashboard/mainnet/TxSteps";
import type { TxStep } from "@/features/account/useSafeAccount";

interface Props {
  owner: Address | undefined;
  safe: Address | undefined;
  maxYield: bigint;
  tickingYield: bigint;
  pay: (amount: bigint, to: Address, label: string) => Promise<boolean>;
  busy: boolean;
  txError: string | null;
  steps: TxStep[];
  explorer?: string;
  /** True while the Vouchers tab is the visible one. */
  active: boolean;
}

const money = (n: number, cur: string) => `${cur ? `${cur} ` : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const primary = "min-h-12 rounded-xl bg-cyan px-6 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.25)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      aria-label={`Copy ${label}`}
      className="min-h-11 rounded-lg border border-white/10 px-3 text-xs font-semibold text-cyan hover:bg-white/5"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function VoucherPanel({ owner, safe, maxYield, tickingYield, pay, busy, txError, steps, explorer, active }: Props) {
  const shop = useVoucherShop({ owner, safe, maxYield, pay, enabled: active });
  const [picked, setPicked] = useState<VoucherProduct | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const p = shop.purchase;

  useEffect(() => {
    setPicked(null);
    setPackageId(null);
    setCustom("");
  }, [shop.country]);

  if (!shop.configured) {
    return (
      <div data-testid="voucher-unconfigured" className="mx-auto max-w-2xl rounded-2xl border border-white/5 bg-surface p-6 text-center">
        <h3 className="text-lg font-bold text-fg">Vouchers aren&rsquo;t switched on here</h3>
        <p className="mt-2 text-sm text-muted">The voucher service isn&rsquo;t connected in this environment.</p>
      </div>
    );
  }

  const face = (): { sel: { packageId: number } | { value: number } | null; label: string } => {
    if (!picked) return { sel: null, label: "" };
    if (custom) {
      const v = Number(custom);
      return validValue(picked, v) ? { sel: { value: v }, label: money(v, picked.currency) } : { sel: null, label: "" };
    }
    const k = picked.packages.find((x) => x.id === packageId);
    return k ? { sel: { packageId: k.id }, label: money(k.value, picked.currency) } : { sel: null, label: "" };
  };
  const choice = face();
  const customInvalid = custom !== "" && picked !== null && !validValue(picked, Number(custom));

  return (
    <div className="mx-auto max-w-4xl space-y-5" data-testid="voucher-panel">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-emerald/20 bg-emerald/5 p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Yield you can spend</p>
          <p data-testid="voucher-yield" className="text-2xl font-extrabold text-emerald tabular">${fmtUsdc(tickingYield)}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Country
          <select data-testid="voucher-country" value={shop.country} onChange={(e) => shop.setCountry(e.target.value as (typeof VOUCHER_COUNTRIES)[number])} className="min-h-11 rounded-lg border border-white/10 bg-surface-2 px-2 font-mono text-fg">
            {VOUCHER_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {(p.stage === "idle" || p.stage === "quoting") && (
        <>
          {shop.catalogError && (
            <div role="alert" data-testid="voucher-catalog-error" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {shop.catalogError} <button type="button" onClick={() => void shop.reloadCatalog()} className="ml-2 underline">Try again</button>
            </div>
          )}
          {!shop.catalogError && shop.products === null && <div data-testid="voucher-loading" aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-surface" />}
          {shop.products && shop.products.length === 0 && (
            <p data-testid="voucher-empty" className="rounded-2xl border border-white/5 bg-surface p-6 text-center text-sm text-muted">No vouchers are available for {shop.country} right now. Try another country.</p>
          )}
          {shop.products && shop.products.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {shop.products.map((pr) => {
                const meta = BRANDS.find((b) => b.id === pr.brand)!;
                const on = picked?.productId === pr.productId;
                return (
                  <button
                    key={pr.productId}
                    type="button"
                    data-testid={`brand-${pr.brand}`}
                    aria-pressed={on}
                    onClick={() => {
                      setPicked(pr);
                      setPackageId(pr.packages[0]?.id ?? null);
                      setCustom("");
                    }}
                    className={`min-h-24 rounded-2xl border p-4 text-left transition ${on ? "border-cyan/50 bg-cyan/10" : "border-white/5 bg-surface hover:bg-surface-2"}`}
                  >
                    <span className="block text-base font-bold text-fg">{meta.label}</span>
                    <span className="mt-1 block font-mono text-[11px] text-muted">{pr.currency || "—"} · {pr.countryCode || shop.country}</span>
                  </button>
                );
              })}
            </div>
          )}

          {picked && (
            <div data-testid="voucher-chooser" className="space-y-4 rounded-2xl border border-white/5 bg-surface p-5">
              <h3 className="text-base font-bold text-fg">{picked.name}</h3>
              {picked.packages.length > 0 && (
                <div role="group" aria-label="Amount" className="flex flex-wrap gap-2">
                  {picked.packages.map((k) => (
                    <button key={k.id} type="button" data-testid={`pkg-${k.id}`} aria-pressed={!custom && packageId === k.id} onClick={() => { setPackageId(k.id); setCustom(""); }} className={`min-h-11 rounded-xl border px-4 font-mono text-sm ${!custom && packageId === k.id ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-white/10 text-fg hover:bg-white/5"}`}>
                      {money(k.value, picked.currency)}
                    </button>
                  ))}
                </div>
              )}
              {picked.range && (
                <div>
                  <label htmlFor="v-custom" className="text-xs text-muted">Or type an amount ({money(picked.range.min, picked.currency)} to {money(picked.range.max, picked.currency)})</label>
                  <input id="v-custom" data-testid="voucher-custom" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} aria-invalid={customInvalid} className="mt-1 min-h-12 w-full rounded-xl border border-white/10 bg-surface-2 px-4 font-mono text-fg outline-none focus:border-cyan/60" />
                  {customInvalid && <p role="alert" className="mt-1 text-xs text-danger">That amount isn&rsquo;t available for this voucher.</p>}
                </div>
              )}
              <button type="button" data-testid="voucher-price" disabled={!choice.sel || p.stage === "quoting"} onClick={() => choice.sel && void shop.quote(picked, choice.sel)} className={primary}>
                {p.stage === "quoting" ? "Getting your price…" : "Get exact price"}
              </button>
              <p className="text-[11px] text-muted">Getting a price is free. Nothing is charged until you confirm.</p>
            </div>
          )}
        </>
      )}

      {p.stage === "quoted" && picked && (
        <div data-testid="voucher-quote" className="space-y-4 rounded-2xl border border-cyan/20 bg-surface p-5">
          <h3 className="text-base font-bold text-fg">{picked.name} · {choice.label}</h3>
          <dl className="space-y-1 font-mono text-sm">
            <div className="flex justify-between"><dt className="text-muted">Price</dt><dd data-testid="quote-price" className="text-fg">{p.quote.price.toFixed(2)} USDC</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Paid from</dt><dd className="text-emerald">your earned yield</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Principal used</dt><dd className="text-fg">$0.00</dd></div>
          </dl>
          <p className="text-xs text-muted">Your Safe withdraws exactly this much yield from Aave and sends it to the voucher provider in one transaction. Pay soon: the price is only held for a short time.</p>
          {!p.affordable && <p role="alert" data-testid="quote-short" className="rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-amber">You have ${fmtUsdc(maxYield)} of yield and this costs {p.quote.price.toFixed(2)}. Only earned yield can be spent, so wait for more yield or pick a smaller voucher.</p>}
          {txError && <p role="alert" data-testid="voucher-tx-error" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{txError}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" data-testid="voucher-pay" disabled={!p.affordable || busy} onClick={() => void shop.payAndDeliver(picked, choice.label)} className={primary}>Pay {p.quote.price.toFixed(2)} USDC from yield</button>
            <button type="button" onClick={shop.reset} className="min-h-12 rounded-xl border border-white/10 px-6 text-sm font-semibold text-fg hover:bg-white/5">Cancel</button>
          </div>
        </div>
      )}

      {p.stage === "paying" && (
        <div data-testid="voucher-paying" aria-live="polite" className="rounded-2xl border border-cyan/20 bg-surface p-5 text-sm text-muted">
          <p className="font-semibold text-fg">Confirm in your wallet…</p>
          <p className="mt-1">Your Safe is paying {p.quote.price.toFixed(2)} USDC from yield.</p>
          <div className="mt-3"><TxSteps steps={steps} explorer={explorer} /></div>
        </div>
      )}

      {p.stage === "delivering" && (
        <div data-testid="voucher-delivering" aria-live="polite" className="rounded-2xl border border-cyan/20 bg-surface p-5 text-sm text-muted">
          <p className="font-semibold text-fg"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" />Paid. Waiting for your voucher…</p>
          <p className="mt-1 font-mono text-xs">Reference {p.quote.invoiceId}. This usually takes under a minute.</p>
        </div>
      )}

      {p.stage === "delivered" && (
        <div data-testid="voucher-delivered" className="space-y-3 rounded-2xl border border-emerald/30 bg-emerald/5 p-5">
          <h3 className="text-base font-bold text-emerald">Your voucher is ready</h3>
          {p.redemptions.length === 0 && <p className="text-sm text-muted">Delivered, but the provider sent no code. Reference {p.quote.invoiceId}.</p>}
          {p.redemptions.map((r, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-surface p-4">
              {r.code && <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wider text-muted">Code</p><p data-testid="voucher-code" className="font-mono text-lg text-fg">{r.code}</p></div><Copy text={r.code} label="code" /></div>}
              {r.pin && <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wider text-muted">PIN</p><p data-testid="voucher-pin" className="font-mono text-fg">{r.pin}</p></div><Copy text={r.pin} label="PIN" /></div>}
              {r.link && /^https:\/\//.test(r.link) && <a data-testid="voucher-link" href={r.link} target="_blank" rel="noopener noreferrer" className="block text-sm text-cyan hover:underline">Open redemption page ↗</a>}
              {r.instructions && <p className="text-xs leading-relaxed text-muted">{r.instructions}</p>}
              {r.expirationDate && <p className="font-mono text-[11px] text-muted">Expires {r.expirationDate}</p>}
            </div>
          ))}
          <p className="text-[11px] text-muted">We don&rsquo;t store your code. Save it now; you can fetch it again from &ldquo;Your vouchers&rdquo; below.</p>
          <button type="button" data-testid="voucher-done" onClick={shop.reset} className="min-h-12 w-full rounded-xl border border-white/10 text-sm font-semibold text-fg hover:bg-white/5">Done</button>
        </div>
      )}

      {p.stage === "failed" && (
        <div role="alert" data-testid="voucher-failed" className="space-y-3 rounded-2xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
          <p>{p.message}</p>
          <button type="button" onClick={shop.reset} className="min-h-11 rounded-xl border border-white/10 px-5 text-sm font-semibold text-fg hover:bg-white/5">Back</button>
        </div>
      )}

      {shop.history.length > 0 && p.stage === "idle" && (
        <div data-testid="voucher-history" className="rounded-2xl border border-white/5 bg-surface p-5">
          <h3 className="text-sm font-bold text-fg">Your vouchers</h3>
          <ul className="mt-3 divide-y divide-white/5">
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
