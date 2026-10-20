"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { VoucherApi, VoucherApiError } from "@/lib/vouchers/api";
import { validValue } from "@/lib/vouchers/brands";
import { usdcBaseUnitsCeil } from "@/lib/vouchers/money";
import type { InvoiceQuote, Redemption, VoucherProduct } from "@/lib/vouchers/types";

export type PurchaseStage =
  | { stage: "idle" }
  | { stage: "quoting" }
  | { stage: "quoted"; quote: InvoiceQuote; amount: bigint; affordable: boolean }
  | { stage: "paying"; quote: InvoiceQuote }
  | { stage: "delivering"; quote: InvoiceQuote }
  | { stage: "delivered"; quote: InvoiceQuote; redemptions: Redemption[] }
  | { stage: "failed"; message: string };

export interface PastVoucher {
  invoiceId: string;
  brand: string;
  face: string;
  priceUsdc: number;
  at: number;
}

const COUNTRIES = ["IN", "US", "GB"] as const;
export type VoucherCountry = (typeof COUNTRIES)[number];
export const VOUCHER_COUNTRIES = COUNTRIES;

const POLL_MS = 4000;
const GIVE_UP_MS = 20 * 60 * 1000;
const histKey = (owner: string) => `oy.vouchers.${owner.toLowerCase()}`;

function loadHistory(owner: string): PastVoucher[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(histKey(owner)) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 20) : [];
  } catch {
    return [];
  }
}
function saveHistory(owner: string, list: PastVoucher[]) {
  try {
    window.localStorage.setItem(histKey(owner), JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage unavailable: history just isn't remembered */
  }
}

function guessCountry(): VoucherCountry {
  const region = (typeof navigator === "undefined" ? "" : navigator.language).split("-")[1]?.toUpperCase();
  return (COUNTRIES as readonly string[]).includes(region ?? "") ? (region as VoucherCountry) : "IN";
}

const apiMessage = (e: unknown) => (e instanceof VoucherApiError ? e.message : "Something went wrong. Nothing was charged.");

interface Deps {
  owner: Address | undefined;
  safe: Address | undefined;
  /** Max yield that may be withdrawn right now, in USDC base units. */
  maxYield: bigint;
  /** Load the catalogue only once the Vouchers tab is actually shown. */
  enabled: boolean;
  /** Pays `amount` of yield to `to` from the Safe; true once confirmed on-chain. */
  pay: (amount: bigint, to: Address, label: string) => Promise<boolean>;
}

/** Browse brands, price a voucher, pay it from yield, wait for delivery. The provider key never reaches the browser. */
export function useVoucherShop({ owner, maxYield, pay, enabled }: Deps) {
  // Same Worker as phone verification by default; a separate URL can be set for the voucher routes.
  const baseUrl = process.env.NEXT_PUBLIC_VOUCHER_API_URL || process.env.NEXT_PUBLIC_VERIFY_API_URL;
  const api = useMemo(() => (baseUrl ? new VoucherApi(baseUrl) : null), [baseUrl]);
  const [country, setCountry] = useState<VoucherCountry>(guessCountry);
  const [products, setProducts] = useState<VoucherProduct[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** The server answered but vouchers are not switched on (no provider key yet, or an older deployment). */
  const [unavailable, setUnavailable] = useState(false);
  const [purchase, setPurchase] = useState<PurchaseStage>({ stage: "idle" });
  const [history, setHistory] = useState<PastVoucher[]>([]);
  const gen = useRef(0); // invalidates polling when the user starts something else

  useEffect(() => {
    if (owner) setHistory(loadHistory(owner));
  }, [owner]);

  const loadCatalog = useCallback(async () => {
    if (!api) return;
    setProducts(null);
    setCatalogError(null);
    try {
      setProducts(await api.catalog(country));
      setUnavailable(false);
    } catch (e) {
      if (e instanceof VoucherApiError && e.code === "UNAVAILABLE") setUnavailable(true);
      else setCatalogError(apiMessage(e));
    }
  }, [api, country]);
  useEffect(() => {
    if (enabled) void loadCatalog();
  }, [enabled, loadCatalog]);

  const reset = useCallback(() => {
    gen.current++;
    setPurchase({ stage: "idle" });
  }, []);

  /** Step 1: ask the provider for the exact USDC price. Free: nothing is charged yet. */
  const quote = useCallback(
    async (product: VoucherProduct, choice: { packageId: string | number } | { value: number }) => {
      if (!api || !owner) return;
      if ("value" in choice && !validValue(product, choice.value)) {
        setPurchase({ stage: "failed", message: "That amount isn't available for this voucher." });
        return;
      }
      const my = ++gen.current;
      setPurchase({ stage: "quoting" });
      try {
        const q = await api.createInvoice({ productId: product.productId, ...choice }, owner, country);
        if (gen.current !== my) return;
        const amount = usdcBaseUnitsCeil(q.price);
        if (amount === null) {
          setPurchase({ stage: "failed", message: "The price we were given looks wrong, so we stopped. Nothing was charged." });
          return;
        }
        setPurchase({ stage: "quoted", quote: q, amount, affordable: amount <= maxYield });
      } catch (e) {
        if (gen.current === my) setPurchase({ stage: "failed", message: apiMessage(e) });
      }
    },
    [api, owner, country, maxYield],
  );

  /** Step 2: one Safe transaction pays the invoice from yield; step 3: poll until delivered. */
  const payAndDeliver = useCallback(
    async (product: VoucherProduct, face: string) => {
      if (purchase.stage !== "quoted" || !api || !owner) return;
      const { quote: q, amount } = purchase;
      if (amount > maxYield) return;
      const my = ++gen.current;
      setPurchase({ stage: "paying", quote: q });
      let paid = false;
      try {
        paid = await pay(amount, q.address as Address, `${product.name} voucher`);
      } catch {
        paid = false; // never leave the screen stuck on "confirm in your wallet"
      }
      if (gen.current !== my) return;
      if (!paid) {
        // The wallet was rejected or the transaction failed: nothing left the Safe, so the quote can be retried.
        setPurchase({ stage: "quoted", quote: q, amount, affordable: amount <= maxYield });
        return;
      }
      const next: PastVoucher = { invoiceId: q.invoiceId, brand: product.name, face, priceUsdc: q.price, at: Date.now() };
      const list = [next, ...history.filter((h) => h.invoiceId !== q.invoiceId)];
      setHistory(list);
      saveHistory(owner, list);
      setPurchase({ stage: "delivering", quote: q });
      const started = Date.now();
      while (gen.current === my && Date.now() - started < GIVE_UP_MS) {
        try {
          const s = await api.status(q.invoiceId);
          if (gen.current !== my) return;
          if (s.state === "delivered") {
            setPurchase({ stage: "delivered", quote: q, redemptions: s.redemptions });
            return;
          }
          if (s.state === "failed") {
            setPurchase({ stage: "failed", message: `The provider could not deliver this voucher (reference ${q.invoiceId}). Contact support with that reference; your payment was sent.` });
            return;
          }
        } catch {
          /* transient: keep polling */
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      if (gen.current === my) setPurchase({ stage: "failed", message: `Delivery is taking longer than expected (reference ${q.invoiceId}). Open "Your vouchers" in a few minutes to check again.` });
    },
    [purchase, api, owner, maxYield, pay, history],
  );

  /** Re-open a past voucher (codes are never stored here; they are fetched again from the provider). */
  const reopen = useCallback(
    async (p: PastVoucher) => {
      if (!api) return;
      const my = ++gen.current;
      setPurchase({ stage: "delivering", quote: { invoiceId: p.invoiceId, address: "", price: p.priceUsdc, currency: "USDC" } });
      try {
        const s = await api.status(p.invoiceId);
        if (gen.current !== my) return;
        setPurchase(s.state === "delivered" ? { stage: "delivered", quote: { invoiceId: p.invoiceId, address: "", price: p.priceUsdc, currency: "USDC" }, redemptions: s.redemptions } : { stage: "failed", message: s.state === "failed" ? `This voucher could not be delivered (reference ${p.invoiceId}).` : "This voucher isn't ready yet. Check again in a few minutes." });
      } catch (e) {
        if (gen.current === my) setPurchase({ stage: "failed", message: apiMessage(e) });
      }
    },
    [api],
  );

  return { configured: !!api, unavailable, country, setCountry, products, catalogError, reloadCatalog: loadCatalog, purchase, quote, payAndDeliver, reset, history, reopen };
}
