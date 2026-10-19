import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../../worker/index";
import { resetVoucherState } from "../../worker/vouchers";

const ADDR = "0x" + "b".repeat(40);
const env = { ALLOWED_ORIGINS: "https://orventyield.tech", BITREFILL_API_KEY: "SECRET-KEY", BITREFILL_BASE_URL: "https://api.test/v2" } as unknown as Env;
const row = (name: string) => ({ id: name.toLowerCase(), name, country_code: "IN", currency: "INR", in_stock: true, packages: [{ id: 1, value: 500 }] });
let upstream: (url: string, init: RequestInit) => unknown;
const calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  resetVoucherState();
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = upstream(url, init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const req = (path: string, init: RequestInit = {}) => new Request(`https://verify.test${path}`, { ...init, headers: { origin: "https://orventyield.tech", "content-type": "application/json", "cf-connecting-ip": "1.2.3.4", ...(init.headers as Record<string, string>) } });
const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body) });

describe("voucher worker", () => {
  it("is unavailable, not broken, when no provider key or base url is configured", async () => {
    const r = await handle(req("/api/vouchers/catalog"), { ALLOWED_ORIGINS: "https://orventyield.tech" } as unknown as Env);
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("NOT_CONFIGURED");
    const noUrl = await handle(req("/api/vouchers/catalog"), { BITREFILL_API_KEY: "k" } as unknown as Env);
    expect(noUrl.status).toBe(503);
  });

  it("serves the catalogue, keeps the key server-side, and caches it", async () => {
    upstream = () => ({ body: { data: [row("Swiggy"), row("Netflix"), row("Zomato")] } });
    const r = await handle(req("/api/vouchers/catalog?country=IN"), env);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.products.map((p: { brand: string }) => p.brand)).toEqual(["swiggy", "zomato"]);
    expect(JSON.stringify(j)).not.toContain("SECRET-KEY");
    expect(r.headers.get("access-control-allow-origin")).toBe("https://orventyield.tech");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer SECRET-KEY");
    await handle(req("/api/vouchers/catalog?country=IN"), env);
    expect(calls).toHaveLength(1); // second call served from cache
  });

  it("rejects bad countries and wrong methods", async () => {
    expect((await handle(req("/api/vouchers/catalog?country=india"), env)).status).toBe(400);
    expect((await handle(req("/api/vouchers/catalog", { method: "POST", body: "{}" }), env)).status).toBe(405);
  });

  it("creates an invoice only for a catalogue product and returns payment details", async () => {
    upstream = (url) => (url.includes("/invoices") ? { body: { data: { id: "inv_123456", payment: { address: ADDR, price: 6.02, currency: "USDC" } } } } : { body: { data: [row("Swiggy")] } });
    const r = await handle(post("/api/vouchers/invoice", { productId: "swiggy", packageId: 1, refundAddress: ADDR, country: "IN" }), env);
    expect(r.status).toBe(200);
    expect((await r.json()).quote).toEqual({ invoiceId: "inv_123456", address: ADDR, price: 6.02, currency: "USDC" });
    const unknown = await handle(post("/api/vouchers/invoice", { productId: "evil-product", packageId: 1, refundAddress: ADDR }), env);
    expect(unknown.status).toBe(404);
  });

  it("validates the request body", async () => {
    upstream = () => ({ body: { data: [row("Swiggy")] } });
    for (const body of [{}, { productId: "swiggy" }, { productId: "swiggy", packageId: 1, value: 5, refundAddress: ADDR }, { productId: "swiggy", packageId: 1, refundAddress: "nope" }]) {
      const r = await handle(post("/api/vouchers/invoice", body), env);
      expect(r.status).toBe(400);
    }
  });

  it("does not leak provider error details and reports status for an invoice", async () => {
    upstream = () => ({ status: 500, body: { secret_detail: "SECRET-KEY leaked?" } });
    const r = await handle(req("/api/vouchers/invoice/inv_123456"), env);
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("SECRET");
    upstream = () => ({ body: { data: { id: "inv_123456", status: "not_delivered", payment: { status: "unpaid" }, orders: [] } } });
    const ok = await handle(req("/api/vouchers/invoice/inv_123456"), env);
    expect((await ok.json()).status.state).toBe("awaiting-payment");
  });

  it("rate limits a single caller", async () => {
    upstream = () => ({ body: { data: [row("Swiggy")] } });
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await handle(req("/api/vouchers/catalog"), env)).status;
    expect(last).toBe(429);
  });
});
