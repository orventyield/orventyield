import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../../worker/index";
import { normalizeOrder, resetTransakState } from "../../worker/transak";

const ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const env = { ALLOWED_ORIGINS: "https://orventyield.tech", TRANSAK_API_KEY: "KEY", TRANSAK_API_SECRET: "SECRET-XYZ", TRANSAK_DEPOSIT_FIELD: "walletAddress" } as unknown as Env;
const calls: { url: string; init: RequestInit }[] = [];
let upstream: (url: string, init: RequestInit) => { status?: number; body: unknown };

beforeEach(() => {
  resetTransakState();
  calls.length = 0;
  upstream = (url) => {
    if (url.endsWith("/refresh-token")) return { body: { data: { accessToken: "TOKEN-1", expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400 } } };
    if (url.endsWith("/auth/session")) return { body: { data: { widgetUrl: "https://global-stg.transak.com?apiKey=KEY&sessionId=abc" } } };
    return { body: { data: { id: "ord-12345678", status: "AWAITING_PAYMENT_FROM_USER", isBuyOrSell: "SELL", cryptoAmount: 1.9, cryptoCurrency: "USDC", network: "arbitrum", walletAddress: ADDR, fiatAmount: 150, fiatCurrency: "INR" } } };
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = upstream(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const req = (path: string, init: RequestInit = {}) => new Request(`https://w.test${path}`, { ...init, headers: { origin: "https://orventyield.tech", "content-type": "application/json", "cf-connecting-ip": "9.9.9.9", ...(init.headers as Record<string, string>) } });
const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body) });

describe("cashout worker: session", () => {
  it("is unavailable (not broken) without credentials, and in production without explicit base URLs", async () => {
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 1.9 }), { ALLOWED_ORIGINS: "https://orventyield.tech" } as unknown as Env)).status).toBe(503);
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 1.9 }), { ...env, TRANSAK_ENV: "production" } as unknown as Env)).status).toBe(503);
  });

  it("creates a fixed-amount USDC/Arbitrum SELL session with the partner token, the user's IP and no secret leaked", async () => {
    const r = await handle(post("/api/cashout/session", { cryptoAmount: 1.9 }), env);
    expect(r.status).toBe(200);
    const text = JSON.stringify(await r.json());
    expect(text).toContain("global-stg.transak.com");
    expect(text).not.toContain("SECRET-XYZ");
    expect(text).not.toContain("TOKEN-1");
    const refresh = calls[0]!;
    expect(refresh.url).toBe("https://api-stg.transak.com/partners/api/v2/refresh-token");
    expect((refresh.init.headers as Record<string, string>)["api-secret"]).toBe("SECRET-XYZ");
    const session = calls[1]!;
    expect(session.url).toBe("https://api-gateway-stg.transak.com/api/v2/auth/session");
    const h = session.init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("KEY");
    expect(h["access-token"]).toBe("TOKEN-1");
    expect(h["x-user-ip"]).toBe("9.9.9.9");
    expect(JSON.parse(String(session.init.body)).widgetParams).toEqual({ apiKey: "KEY", referrerDomain: "orventyield.tech", productsAvailed: "SELL", cryptoCurrencyCode: "USDC", network: "arbitrum", cryptoAmount: 1.9 });
  });

  it("caches the access token and refreshes it once on a 401", async () => {
    await handle(post("/api/cashout/session", { cryptoAmount: 1 }), env);
    await handle(post("/api/cashout/session", { cryptoAmount: 2 }), env);
    expect(calls.filter((c) => c.url.endsWith("/refresh-token"))).toHaveLength(1);
    let first = true;
    upstream = (url) => {
      if (url.endsWith("/refresh-token")) return { body: { data: { accessToken: "TOKEN-2", expiresAt: Math.floor(Date.now() / 1000) + 86400 } } };
      if (first) { first = false; return { status: 401, body: {} }; }
      return { body: { data: { widgetUrl: "https://global-stg.transak.com?sessionId=z" } } };
    };
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 3 }), env)).status).toBe(200);
  });

  it("refuses bad amounts before calling Transak", async () => {
    for (const amount of [0, -1, 500.01, 1.999, NaN, "5", null, undefined, 1e9]) {
      calls.length = 0;
      expect((await handle(post("/api/cashout/session", { cryptoAmount: amount }), env)).status, String(amount)).toBe(400);
      expect(calls).toHaveLength(0);
    }
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 500 }), env)).status).toBe(200); // max
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 0.01 }), env)).status).toBe(200); // dust
  });

  it("refuses a widget URL on an unexpected host", async () => {
    upstream = (url) => (url.endsWith("/refresh-token") ? { body: { data: { accessToken: "T", expiresAt: 9999999999 } } } : { body: { data: { widgetUrl: "https://evil.example/?x=1" } } });
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 1 }), env)).status).toBe(502);
    upstream = (url) => (url.endsWith("/refresh-token") ? { body: { data: { accessToken: "T", expiresAt: 9999999999 } } } : { body: { data: { widgetUrl: "http://global.transak.com/?x=1" } } });
    expect((await handle(post("/api/cashout/session", { cryptoAmount: 1 }), env)).status).toBe(502);
  });

  it("does not leak upstream details", async () => {
    upstream = () => ({ status: 500, body: { secret: "SECRET-XYZ" } });
    const r = await handle(post("/api/cashout/session", { cryptoAmount: 1 }), env);
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("SECRET");
  });
});

describe("cashout worker: status", () => {
  it("says available when configured, makes no upstream call, and 503 when not", async () => {
    const r = await handle(req("/api/cashout/status"), env);
    expect(await r.json()).toEqual({ ok: true, available: true });
    expect(calls).toHaveLength(0);
    expect((await handle(req("/api/cashout/status"), { ALLOWED_ORIGINS: "https://orventyield.tech" } as unknown as Env)).status).toBe(503);
  });
});

describe("cashout worker: order", () => {
  it("returns the normalised order with the deposit address only from the operator-confirmed field", async () => {
    const j = await (await handle(req("/api/cashout/order/ord-12345678"), env)).json();
    expect(j.order).toMatchObject({ id: "ord-12345678", status: "AWAITING_PAYMENT_FROM_USER", side: "SELL", cryptoAmount: "1.9", currency: "USDC", network: "arbitrum", depositAddress: ADDR });
    const unset = await (await handle(req("/api/cashout/order/ord-12345678"), { ...env, TRANSAK_DEPOSIT_FIELD: undefined } as unknown as Env)).json();
    expect(unset.order.depositAddress).toBeNull(); // nothing can be paid until the field is confirmed
  });
  it("never returns an invalid address, and ignores odd field names", () => {
    expect(normalizeOrder({ walletAddress: "0x123" }, "walletAddress").depositAddress).toBeNull();
    expect(normalizeOrder({ walletAddress: ADDR }, "wallet;drop").depositAddress).toBeNull();
    expect(normalizeOrder({ walletAddress: ADDR.toLowerCase().replace("0xd8da", "0xD8dA") }, "walletAddress").depositAddress).toBeNull(); // broken checksum
    expect(normalizeOrder(null, "walletAddress").status).toBe("");
  });
  it("validates ids, maps 404, and keeps the key out of the URL", async () => {
    expect((await handle(req("/api/cashout/order/..%2Fetc"), env)).status).toBe(400);
    upstream = (url) => (url.endsWith("/refresh-token") ? { body: { data: { accessToken: "T", expiresAt: 9999999999 } } } : { status: 404, body: {} });
    expect((await handle(req("/api/cashout/order/ord-12345678"), env)).status).toBe(404);
    expect(calls.every((c) => !c.url.includes("KEY") && !c.url.includes("SECRET"))).toBe(true);
  });
  it("rate limits one caller", async () => {
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await handle(req("/api/cashout/order/ord-12345678"), env)).status;
    expect(last).toBe(429);
  });
});
