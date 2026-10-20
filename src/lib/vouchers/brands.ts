import type { BrandId, VoucherProduct } from "./types";

export const BRANDS: { id: BrandId; label: string; match: RegExp }[] = [
  { id: "amazon", label: "Amazon", match: /^amazon\b/i },
  { id: "flipkart", label: "Flipkart", match: /^flipkart\b/i },
  { id: "swiggy", label: "Swiggy", match: /^swiggy\b/i },
  { id: "zomato", label: "Zomato", match: /^zomato\b/i },
  { id: "uber", label: "Uber", match: /^uber\b(?!\s*eats)/i },
];

/** Hard ceiling per voucher, in USDC. Limits the blast radius of any bug or abuse. */
export const MAX_VOUCHER_USDC = 200;

interface RawProduct {
  id?: unknown;
  name?: unknown;
  country_code?: unknown;
  currency?: unknown;
  image?: unknown;
  in_stock?: unknown;
  packages?: unknown;
  range?: unknown;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

/** Pick, per brand, the first in-stock product that has something to buy. Unknown or malformed rows are skipped. */
export function pickBrandProducts(raw: unknown[]): VoucherProduct[] {
  const out = new Map<BrandId, VoucherProduct>();
  for (const r of raw as RawProduct[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || typeof r.name !== "string" || r.in_stock !== true) continue;
    const brand = BRANDS.find((b) => b.match.test(r.name as string));
    if (!brand || out.has(brand.id)) continue;

    const packages = (Array.isArray(r.packages) ? r.packages : [])
      .map((p) => {
        const rawPkg = p as { id?: unknown; value?: unknown; amount?: unknown };
        const id = rawPkg?.id !== undefined && rawPkg?.id !== null ? (typeof rawPkg.id === "number" ? rawPkg.id : String(rawPkg.id)) : null;
        const val = num(rawPkg?.amount) ?? num(rawPkg?.value);
        return { id, value: val && Number.isFinite(val) ? val : null };
      })
      .filter((p): p is { id: string | number; value: number } => p.id !== null && p.value !== null && p.value > 0);
    const rg = r.range as { min?: unknown; max?: unknown; step?: unknown } | undefined;
    const min = num(rg?.min);
    const max = num(rg?.max);
    const range = min !== null && max !== null && max >= min && min > 0 ? { min, max, step: num(rg?.step) ?? 1 } : undefined;
    if (packages.length === 0 && !range) continue;

    out.set(brand.id, {
      brand: brand.id,
      productId: r.id,
      name: r.name,
      countryCode: typeof r.country_code === "string" ? r.country_code : "",
      currency: typeof r.currency === "string" ? r.currency : "",
      image: typeof r.image === "string" && r.image.startsWith("https://") ? r.image : undefined,
      packages,
      range,
    });
  }
  return BRANDS.map((b) => out.get(b.id)).filter((p): p is VoucherProduct => !!p);
}

/** Is `value` a purchasable face value for this product (listed package, or inside the range on its step)? */
export function validValue(p: VoucherProduct, value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  if (p.packages.some((k) => k.value === value)) return true;
  if (!p.range) return false;
  const { min, max, step } = p.range;
  if (value < min || value > max) return false;
  return step > 0 ? Math.abs(((value - min) / step) % 1) < 1e-9 || Math.abs(((value - min) / step) % 1 - 1) < 1e-9 : true;
}
