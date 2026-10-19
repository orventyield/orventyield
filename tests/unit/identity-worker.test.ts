import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { handle, type Env } from "../../worker/index";
import { sqliteD1 } from "../helpers/sqliteD1";

const ORIGIN = "https://orventyield.tech";
const base = (over: Partial<Env> = {}): Env => ({
  DB: sqliteD1().db,
  PEPPER: "unit-test-pepper-0123456789",
  OTP_PROVIDER: "mock",
  ALLOW_MOCK_OTP: "1",
  MOCK_OTP_CODE: "123456",
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:3000`,
  ...over,
});

let ipCounter = 0;
const req = (path: string, init: { method?: string; body?: unknown; ip?: string; origin?: string; headers?: Record<string, string> } = {}) =>
  new Request(`https://api.test${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": init.ip ?? `10.0.0.${++ipCounter}`,
      ...(init.origin ? { origin: init.origin } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });

const j = async (r: Response) => (await r.json()) as Record<string, unknown>;
const guest = (n: string) => `guest:${n.padEnd(16, "x")}`;

describe("verification API (Worker)", () => {
  it("health, 404 and method checks", async () => {
    const env = base();
    expect((await handle(req("/api/health"), env)).status).toBe(200);
    expect((await handle(req("/api/nope"), env)).status).toBe(404);
    expect((await handle(req("/api/verify/start"), env)).status).toBe(405);
    expect((await handle(req("/api/verify/status", { body: {} }), env)).status).toBe(405);
  });

  it("every response is uncacheable and sniff-proof", async () => {
    const r = await handle(req("/api/health"), base());
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  describe("CORS", () => {
    it("allows listed origins only", async () => {
      const env = base();
      const ok = await handle(req("/api/verify/status?owner=" + guest("a"), { origin: ORIGIN }), env);
      expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      const evil = await handle(req("/api/verify/status?owner=" + guest("a"), { origin: "https://evil.example" }), env);
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    });
    it("answers preflight", async () => {
      const r = await handle(req("/api/verify/start", { method: "OPTIONS", origin: ORIGIN }), base());
      expect(r.status).toBe(204);
      expect(r.headers.get("access-control-allow-methods")).toContain("POST");
      expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    });
  });

  describe("input hardening", () => {
    it.each([
      ["not json", "{oops"],
      ["array body", "[]"],
      ["missing fields", { phone: "+919876543210" }],
      ["wrong types", { phone: 123, owner: guest("a") }],
      ["oversized", { phone: "+919876543210", owner: guest("a"), pad: "x".repeat(5000) }],
    ])("rejects %s with 400", async (_n, body) => {
      const r = await handle(req("/api/verify/start", { body }), base());
      expect(r.status).toBe(400);
      expect((await j(r)).ok).toBe(false);
    });
    it("requires a JSON content type", async () => {
      const r = await handle(req("/api/verify/start", { body: "x", headers: { "content-type": "text/plain" } }), base());
      expect(r.status).toBe(400);
    });
    it("validates the phone number and returns the typed error", async () => {
      const r = await handle(req("/api/verify/start", { body: { phone: "9876543210", owner: guest("a") } }), base());
      expect(r.status).toBe(400);
      expect(await j(r)).toMatchObject({ ok: false, code: "INVALID_FORMAT" });
    });
  });

  describe("end to end over HTTP", () => {
    it("start, check, status; then the same phone is rejected for another user", async () => {
      const env = base();
      const phone = "+919876543210";
      const start = await j(await handle(req("/api/verify/start", { body: { phone, owner: guest("alice") } }), env));
      expect(start).toMatchObject({ ok: true, alreadyActive: false, maskedPhone: "+91 ••••••3210" });

      const wrong = await handle(req("/api/verify/check", { body: { phone, owner: guest("alice"), nonce: start.nonce, code: "000000" } }), env);
      expect(wrong.status).toBe(400);
      expect(await j(wrong)).toMatchObject({ code: "INVALID_CODE", attemptsLeft: 4 });

      const done = await handle(req("/api/verify/check", { body: { phone, owner: guest("alice"), nonce: start.nonce, code: "123456" } }), env);
      expect(done.status).toBe(200);
      expect(await j(done)).toMatchObject({ ok: true, active: true });

      expect(await j(await handle(req("/api/verify/status?owner=" + guest("alice")), env))).toMatchObject({ ok: true, active: true });
      expect(await j(await handle(req("/api/verify/status?owner=" + guest("bob")), env))).toMatchObject({ ok: true, active: false });

      const dup = await handle(req("/api/verify/start", { body: { phone, owner: guest("mallory") } }), env);
      expect(dup.status).toBe(409);
      expect(await j(dup)).toMatchObject({ ok: false, code: "PHONE_ALREADY_BOUND", message: "Card already active for this verified identity." });
    });

    it("rate limiting returns 429 with a Retry-After header, keyed by cf-connecting-ip", async () => {
      const env = base();
      const send = (i: number, ip: string) => handle(req("/api/verify/start", { ip, body: { phone: `+9198765432${10 + i}`, owner: guest(`u${i}`) } }), env);
      for (let i = 0; i < 5; i++) expect((await send(i, "203.0.113.5")).status).toBe(200);
      const limited = await send(6, "203.0.113.5");
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await j(limited)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
      expect((await send(7, "203.0.113.6")).status).toBe(200);
    });

    it("wallet owners need a valid signature over the issued message", async () => {
      const env = base();
      const acct = privateKeyToAccount(generatePrivateKey());
      const phone = "+447911123456";
      const start = await j(await handle(req("/api/verify/start", { body: { phone, owner: acct.address } }), env));
      expect(typeof start.messageToSign).toBe("string");
      const noSig = await handle(req("/api/verify/check", { body: { phone, owner: acct.address, nonce: start.nonce, code: "123456" } }), env);
      expect(noSig.status).toBe(401);
      const signature = await acct.signMessage({ message: start.messageToSign as string });
      const ok = await handle(req("/api/verify/check", { body: { phone, owner: acct.address, nonce: start.nonce, code: "123456", signature } }), env);
      expect(ok.status).toBe(200);
    });
  });

  describe("configuration safety", () => {
    it("refuses the mock provider unless explicitly allowed (production must not accept 123456)", async () => {
      const r = await handle(req("/api/verify/start", { body: { phone: "+919876543210", owner: guest("a") } }), base({ ALLOW_MOCK_OTP: undefined }));
      expect(r.status).toBe(500);
      expect(await j(r)).toMatchObject({ code: "NOT_CONFIGURED" });
    });
    it("refuses to run without a strong pepper", async () => {
      for (const pepper of [undefined, "", "short"]) {
        const r = await handle(req("/api/verify/start", { body: { phone: "+919876543210", owner: guest("a") } }), base({ PEPPER: pepper }));
        expect(r.status).toBe(500);
      }
    });
    it("twilio mode without credentials is not usable", async () => {
      const r = await handle(req("/api/verify/start", { body: { phone: "+919876543210", owner: guest("a") } }), base({ OTP_PROVIDER: "twilio" }));
      expect(r.status).toBe(500);
    });
    it("never leaks internal errors", async () => {
      const broken = base({ DB: { prepare: () => { throw new Error("secret db detail"); } } as never });
      const r = await handle(req("/api/verify/status?owner=" + guest("a")), broken);
      expect(r.status).toBe(500);
      expect(JSON.stringify(await j(r))).not.toContain("secret db detail");
    });
    it("honours the country allow-list and SMS cap from env", async () => {
      const env = base({ ALLOWED_COUNTRIES: "IN", DAILY_SMS_CAP: "1" });
      expect((await handle(req("/api/verify/start", { body: { phone: "+447911123456", owner: guest("a") } }), env)).status).toBe(400);
      expect((await handle(req("/api/verify/start", { body: { phone: "+919876543210", owner: guest("a") } }), env)).status).toBe(200);
      expect((await handle(req("/api/verify/start", { body: { phone: "+919876543211", owner: guest("b") } }), env)).status).toBe(503);
    });
  });
});
