/**
 * OrventYield verification API (Cloudflare Worker + D1).
 *
 *   GET  /api/health
 *   GET  /api/verify/status?owner=<0x… | guest:…>
 *   POST /api/verify/start   { phone: "+E164", owner }
 *   POST /api/verify/check   { phone, code, owner, nonce, signature? }
 *   GET|POST /api/vouchers/*  voucher catalogue, invoices and delivery (see vouchers.ts)
 *   GET|POST /api/cashout/*   bank / UPI cashout through Transak SELL (see transak.ts)
 *
 * Secrets (wrangler secret put): PEPPER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID,
 * and for vouchers BITREFILL_API_KEY (or BITREFILL_API_ID + BITREFILL_API_SECRET) with the BITREFILL_BASE_URL var.
 * The mock OTP provider is refused unless ALLOW_MOCK_OTP=1, which production must never set.
 */
import { D1Store, type D1Like } from "../src/lib/identity/d1";
import { TwilioVerifyProvider, type CheckResult, type OtpProvider } from "../src/lib/identity/otp";
import { DEFAULT_CONFIG, VerificationService, VerifyError, type VerifyConfig } from "../src/lib/identity/service";
import { handleCashout, type TransakEnv } from "./transak";
import { handleVouchers, type VoucherEnv } from "./vouchers";

export interface Env extends VoucherEnv, TransakEnv {
  DB: D1Like;
  PEPPER?: string;
  OTP_PROVIDER?: string;
  /** Name shown in the SMS ("Your OrventYield verification code is..."). Defaults to OrventYield. */
  OTP_BRAND?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
  ALLOW_MOCK_OTP?: string;
  MOCK_OTP_CODE?: string;
  ALLOWED_ORIGINS?: string;
  ALLOWED_COUNTRIES?: string;
  DAILY_SMS_CAP?: string;
  REQUIRE_WALLET_SIGNATURE?: string;
}

/** Stateless stand-in for local development: any session approves exactly one fixed code. Never used in production. */
class FixedCodeProvider implements OtpProvider {
  readonly name = "mock-fixed";
  constructor(private code: string) {}
  async start() {}
  async check(_e164: string, code: string): Promise<CheckResult> {
    return code === this.code ? "approved" : "rejected";
  }
}

class ConfigError extends Error {}

function provider(env: Env): OtpProvider {
  if (env.OTP_PROVIDER === "mock") {
    if (env.ALLOW_MOCK_OTP !== "1") throw new ConfigError("mock OTP provider is disabled");
    return new FixedCodeProvider(env.MOCK_OTP_CODE ?? "123456");
  }
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_VERIFY_SERVICE_SID: serviceSid } = env;
  if (!accountSid || !authToken || !serviceSid) throw new ConfigError("twilio is not configured");
  return new TwilioVerifyProvider({ accountSid, authToken, serviceSid, brand: env.OTP_BRAND ?? "OrventYield" });
}

function config(env: Env): VerifyConfig {
  if (!env.PEPPER || env.PEPPER.length < 16) throw new ConfigError("PEPPER must be set (16+ characters)");
  const cap = Number(env.DAILY_SMS_CAP);
  return {
    ...DEFAULT_CONFIG,
    pepper: env.PEPPER,
    requireWalletSignature: env.REQUIRE_WALLET_SIGNATURE !== "0",
    allowedCountries: env.ALLOWED_COUNTRIES ? env.ALLOWED_COUNTRIES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined,
    dailySmsCap: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_CONFIG.dailySmsCap,
  };
}

const MAX_BODY_BYTES = 2048;

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const base: Record<string, string> = { vary: "origin" };
  if (origin && allowed.includes(origin)) {
    base["access-control-allow-origin"] = origin;
    base["access-control-allow-methods"] = "GET, POST, OPTIONS";
    base["access-control-allow-headers"] = "content-type";
    base["access-control-max-age"] = "600";
  }
  return base;
}

function json(body: unknown, status: number, headers: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers, ...extra },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

export async function handle(request: Request, env: Env): Promise<Response> {
  const h = cors(request, env);
  const url = new URL(request.url);
  const bad = (message: string, status = 400) => json({ ok: false, code: "BAD_REQUEST", message }, status, h);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (url.pathname === "/api/health") return json({ ok: true }, 200, h);

  if (url.pathname.startsWith("/api/cashout/")) {
    return handleCashout(request, env, url, (body, status, extra) => json(body, status, h, extra), readJson);
  }
  if (url.pathname.startsWith("/api/vouchers/")) {
    return handleVouchers(request, env, url, (body, status, extra) => json(body, status, h, extra), readJson);
  }

  try {
    if (!url.pathname.startsWith("/api/verify/")) return json({ ok: false, code: "NOT_FOUND", message: "Not found." }, 404, h);
    const svc = new VerificationService({
      store: new D1Store(env.DB),
      otp: provider(env),
      config: config(env),
      // One JSON line per provider failure: find it with `wrangler tail` or in Workers Logs. It never contains a phone number.
      log: (entry) => console.error(JSON.stringify(entry)),
    });
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

    if (url.pathname === "/api/verify/status") {
      if (request.method !== "GET") return bad("Method not allowed.", 405);
      const owner = str(url.searchParams.get("owner"), 80);
      if (!owner) return bad("owner is required.");
      return json({ ok: true, ...(await svc.status(owner)) }, 200, h);
    }

    if (url.pathname === "/api/verify/start") {
      if (request.method !== "POST") return bad("Method not allowed.", 405);
      const body = await readJson(request);
      const phone = str(body?.phone, 24);
      const owner = str(body?.owner, 80);
      if (!body || !phone || !owner) return bad("phone and owner are required.");
      return json({ ok: true, ...(await svc.start({ phone, owner, ip })) }, 200, h);
    }

    if (url.pathname === "/api/verify/check") {
      if (request.method !== "POST") return bad("Method not allowed.", 405);
      const body = await readJson(request);
      const phone = str(body?.phone, 24);
      const owner = str(body?.owner, 80);
      const code = str(body?.code, 12);
      const nonce = str(body?.nonce, 64);
      const signature = body?.signature === undefined ? undefined : str(body.signature, 200);
      if (!body || !phone || !owner || !code || !nonce || signature === null) return bad("phone, owner, code and nonce are required.");
      return json({ ok: true, ...(await svc.check({ phone, owner, code, nonce, ip, signature })) }, 200, h);
    }

    return json({ ok: false, code: "NOT_FOUND", message: "Not found." }, 404, h);
  } catch (e) {
    if (e instanceof VerifyError) {
      const extra: Record<string, string> = e.extra.retryAfterSec ? { "retry-after": String(e.extra.retryAfterSec) } : {};
      return json({ ok: false, code: e.code, message: e.message, retryAfterSec: e.extra.retryAfterSec, attemptsLeft: e.extra.attemptsLeft }, e.status, h, extra);
    }
    if (e instanceof ConfigError) return json({ ok: false, code: "NOT_CONFIGURED", message: "Verification is not available." }, 500, h);
    return json({ ok: false, code: "INTERNAL", message: "Something went wrong." }, 500, h);
  }
}

export default { fetch: handle };
