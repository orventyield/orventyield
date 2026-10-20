/**
 * Voucher API (proxy for Bitrefill). The provider key lives here, never in the browser.
 *
 *   GET  /api/vouchers/catalog?country=IN             brands we offer, with denominations
 *   POST /api/vouchers/invoice  { productId, packageId | value, refundAddress, country }
 *                                                     creates an UNPAID invoice payable in USDC on Arbitrum
 *   GET  /api/vouchers/invoice/<id>                   status, plus redemption details once delivered
 *
 * Secrets: BITREFILL_API_KEY (Personal, Bearer) or BITREFILL_API_ID + BITREFILL_API_SECRET (Business, Basic).
 * Vars: BITREFILL_BASE_URL (the API base from docs.bitrefill.com; required, we do not guess it).
 * Nothing is charged by creating an invoice; money only moves when the user's Safe sends USDC to its address.
 */
import { BitrefillClient, BitrefillError, type BitrefillConfig } from "../src/lib/vouchers/bitrefill";
import type { PurchaseSelection, VoucherProduct } from "../src/lib/vouchers/types";

export interface VoucherEnv {
  BITREFILL_API_KEY?: string;
  BITREFILL_API_ID?: string;
  BITREFILL_API_SECRET?: string;
  BITREFILL_BASE_URL?: string;
}

type Reply = (body: unknown, status: number, extra?: Record<string, string>) => Response;

const COUNTRIES = /^[A-Z]{2}(,[A-Z]{2}){0,3}$/;
const CATALOG_TTL_MS = 30 * 60 * 1000;
const RATE_PER_MINUTE = 30;

// Per-isolate state. A best-effort guard only: add a Cloudflare rate-limiting rule for /api/vouchers/* in production.
const catalogCache = new Map<string, { at: number; products: VoucherProduct[] }>();
const hits = new Map<string, number[]>();

export function resetVoucherState() {
  catalogCache.clear();
  hits.clear();
}

function limited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // bound memory
  return recent.length > RATE_PER_MINUTE;
}

function clientFor(env: VoucherEnv): BitrefillClient | null {
  const baseUrl = env.BITREFILL_BASE_URL;
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) return null;
  let auth: BitrefillConfig["auth"] | null = null;
  if (env.BITREFILL_API_ID && env.BITREFILL_API_SECRET) auth = { kind: "basic", id: env.BITREFILL_API_ID, secret: env.BITREFILL_API_SECRET };
  else if (env.BITREFILL_API_KEY) auth = { kind: "bearer", key: env.BITREFILL_API_KEY };
  return auth ? new BitrefillClient({ baseUrl: baseUrl.replace(/\/$/, ""), auth }) : null;
}

async function products(client: BitrefillClient, countries: string): Promise<VoucherProduct[]> {
  const hit = catalogCache.get(countries);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.products;
  const list = await client.catalog(countries);
  catalogCache.set(countries, { at: Date.now(), products: list });
  return list;
}

export async function handleVouchers(request: Request, env: VoucherEnv, url: URL, reply: Reply, readJson: (r: Request) => Promise<Record<string, unknown> | null>): Promise<Response> {
  const client = clientFor(env);
  if (!client) return reply({ ok: false, code: "NOT_CONFIGURED", message: "Vouchers are not available yet." }, 503);
  if (limited(request.headers.get("cf-connecting-ip") ?? "unknown")) return reply({ ok: false, code: "RATE_LIMITED", message: "Too many requests. Try again in a minute." }, 429, { "retry-after": "60" });

  try {
    if (url.pathname === "/api/vouchers/catalog") {
      if (request.method !== "GET") return reply({ ok: false, code: "BAD_REQUEST", message: "Method not allowed." }, 405);
      const country = (url.searchParams.get("country") ?? "IN").toUpperCase();
      if (!COUNTRIES.test(country)) return reply({ ok: false, code: "BAD_REQUEST", message: "Invalid country." }, 400);
      return reply({ ok: true, products: await products(client, country) }, 200);
    }

    if (url.pathname === "/api/vouchers/invoice" && request.method === "POST") {
      const body = await readJson(request);
      const productId = typeof body?.productId === "string" ? body.productId : "";
      const refund = typeof body?.refundAddress === "string" ? body.refundAddress : "";
      const country = String(body?.country ?? "IN").toUpperCase();
      const hasPkg = (typeof body?.packageId === "string" && body.packageId.length > 0) || typeof body?.packageId === "number";
      const hasVal = typeof body?.value === "number";
      if (!body || !productId || !COUNTRIES.test(country) || hasPkg === hasVal) return reply({ ok: false, code: "BAD_REQUEST", message: "productId, country and exactly one of packageId or value are required." }, 400);
      const product = (await products(client, country)).find((p) => p.productId === productId);
      if (!product) return reply({ ok: false, code: "UNKNOWN_PRODUCT", message: "That voucher is not offered." }, 404);
      const sel: PurchaseSelection = hasPkg ? { productId, packageId: body.packageId as string | number } : { productId, value: body.value as number };
      return reply({ ok: true, quote: await client.createInvoice(product, sel, refund) }, 200);
    }

    const m = /^\/api\/vouchers\/invoice\/([^/]+)$/.exec(url.pathname);
    if (m && request.method === "GET") return reply({ ok: true, status: await client.status(decodeURIComponent(m[1]!)) }, 200);

    return reply({ ok: false, code: "NOT_FOUND", message: "Not found." }, 404);
  } catch (e) {
    if (e instanceof BitrefillError) return reply({ ok: false, code: e.code, message: e.status === 400 ? e.message : "The voucher provider had a problem. Nothing was charged." }, e.status === 429 ? 429 : e.status === 400 || e.status === 404 ? e.status : 502);
    return reply({ ok: false, code: "INTERNAL", message: "Something went wrong." }, 500);
  }
}
