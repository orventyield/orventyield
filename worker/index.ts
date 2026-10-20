/**
 * OrventYield API broker (Cloudflare Worker). Stateless: no database, no user data. It only keeps provider API keys
 * off the browser.
 *
 *   GET      /api/health
 *   GET|POST /api/vouchers/*  voucher catalogue, invoices and delivery (see vouchers.ts)
 *   GET|POST /api/cashout/*   bank / UPI cashout through Transak SELL (see transak.ts)
 *
 * Secrets (wrangler secret put): for vouchers BITREFILL_API_KEY (or BITREFILL_API_ID + BITREFILL_API_SECRET) with the
 * BITREFILL_BASE_URL var; for cashout TRANSAK_API_KEY and TRANSAK_API_SECRET.
 */
import { handleCashout, type TransakEnv } from "./transak";
import { handleVouchers, type VoucherEnv } from "./vouchers";

export interface Env extends VoucherEnv, TransakEnv {
  ALLOWED_ORIGINS?: string;
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


export async function handle(request: Request, env: Env): Promise<Response> {
  const h = cors(request, env);
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (url.pathname === "/api/health") return json({ ok: true }, 200, h);

  if (url.pathname.startsWith("/api/cashout/")) {
    return handleCashout(request, env, url, (body, status, extra) => json(body, status, h, extra), readJson);
  }
  if (url.pathname.startsWith("/api/vouchers/")) {
    return handleVouchers(request, env, url, (body, status, extra) => json(body, status, h, extra), readJson);
  }

  return json({ ok: false, code: "NOT_FOUND", message: "Not found." }, 404, h);
}

export default { fetch: handle };
