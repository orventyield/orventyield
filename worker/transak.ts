/**
 * Cashout API (proxy for Transak's SELL widget). The partner secret never reaches the browser.
 *
 *   POST /api/cashout/session   { cryptoAmount }   creates a single-use widget URL for a fixed USDC (Arbitrum) SELL
 *   GET  /api/cashout/status                       { ok: true } when credentials are configured (no upstream call)
 *   GET  /api/cashout/order/<id>                   the order as Transak reports it, normalised, deposit address included
 *                                                  ONLY when the operator confirmed which order field carries it
 *
 * Secrets: TRANSAK_API_KEY, TRANSAK_API_SECRET. Vars: TRANSAK_ENV ("staging" default | "production"), TRANSAK_REFERRER,
 * TRANSAK_DEPOSIT_FIELD, and for production TRANSAK_GATEWAY_BASE + TRANSAK_PARTNERS_BASE (not published in Transak's docs, so we
 * do not guess them). Docs: docs.transak.com (Create Widget URL, Get Order By ID, Partner Access Token, Mandatory Security Changes).
 *
 * OPEN ITEMS that need a real staging key (see scripts/transak-staging-probe.mjs):
 *   1. Which field of a SELL order holds the address the user must pay. Until TRANSAK_DEPOSIT_FIELD is set, depositAddress is null
 *      and the app refuses to send anything.
 *   2. Transak asks partners to allowlist static egress IPs; Cloudflare Workers have none. The first live call tells us if staging
 *      enforces it.
 */
import { isAddress } from "viem";

export interface TransakEnv {
  TRANSAK_API_KEY?: string;
  TRANSAK_API_SECRET?: string;
  TRANSAK_ENV?: string;
  TRANSAK_REFERRER?: string;
  TRANSAK_DEPOSIT_FIELD?: string;
  TRANSAK_GATEWAY_BASE?: string;
  TRANSAK_PARTNERS_BASE?: string;
}

type Reply = (body: unknown, status: number, extra?: Record<string, string>) => Response;

const STAGING = { gateway: "https://api-gateway-stg.transak.com", partners: "https://api-stg.transak.com" };
const WIDGET_HOSTS = ["global.transak.com", "global-stg.transak.com"];
const MAX_USDC = 500;
const RATE_PER_MINUTE = 20;
const ORDER_ID = /^[A-Za-z0-9-]{8,64}$/;

const hits = new Map<string, number[]>();
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export function resetTransakState() {
  hits.clear();
  tokenCache = null;
}

function limited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_PER_MINUTE;
}

function bases(env: TransakEnv): { gateway: string; partners: string } | null {
  if ((env.TRANSAK_ENV ?? "staging") !== "production") return STAGING;
  const { TRANSAK_GATEWAY_BASE: g, TRANSAK_PARTNERS_BASE: p } = env;
  return g?.startsWith("https://") && p?.startsWith("https://") ? { gateway: g.replace(/\/$/, ""), partners: p.replace(/\/$/, "") } : null;
}

/** Partner access token: 7 days, cached in memory and refreshed a little early. */
async function accessToken(env: TransakEnv, b: { partners: string }, force = false): Promise<string> {
  const key = env.TRANSAK_API_KEY!;
  if (!force && tokenCache && tokenCache.key === key && tokenCache.expiresAt - 300_000 > Date.now()) return tokenCache.token;
  const res = await fetch(`${b.partners}/partners/api/v2/refresh-token`, {
    method: "POST",
    headers: { "api-secret": env.TRANSAK_API_SECRET!, "x-api-key": key, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ apiKey: key }),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string; expiresAt?: number } };
  if (!res.ok || !j.data?.accessToken) throw new Error(`transak token failed: ${res.status}`);
  tokenCache = { key, token: j.data.accessToken, expiresAt: (j.data.expiresAt ?? Math.floor(Date.now() / 1000) + 3600) * 1000 };
  return tokenCache.token;
}

/** Normalise a Transak order. depositAddress comes ONLY from the operator-confirmed field; otherwise it is null. */
export function normalizeOrder(raw: unknown, depositField: string | undefined) {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  let depositAddress: string | null = null;
  const candidate = depositField && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(depositField) ? o[depositField] : undefined;
  if (typeof candidate === "string" && isAddress(candidate, { strict: true })) depositAddress = candidate;
  return {
    id: s(o.id) || s(o._id),
    status: s(o.status),
    side: s(o.isBuyOrSell),
    cryptoAmount: typeof o.cryptoAmount === "number" ? String(o.cryptoAmount) : s(o.cryptoAmount),
    currency: s(o.cryptoCurrency),
    network: s(o.network),
    depositAddress,
    fiatAmount: typeof o.fiatAmount === "number" ? o.fiatAmount : undefined,
    fiatCurrency: s(o.fiatCurrency) || undefined,
  };
}

export async function handleCashout(
  request: Request,
  env: TransakEnv,
  url: URL,
  reply: Reply,
  readJson: (r: Request) => Promise<Record<string, unknown> | null>,
): Promise<Response> {
  const b = bases(env);
  if (!env.TRANSAK_API_KEY || !env.TRANSAK_API_SECRET || !b) return reply({ ok: false, code: "NOT_CONFIGURED", message: "Cashout is not available yet." }, 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (limited(ip)) return reply({ ok: false, code: "RATE_LIMITED", message: "Too many requests. Try again in a minute." }, 429, { "retry-after": "60" });

  try {
    if (url.pathname === "/api/cashout/status" && request.method === "GET") return reply({ ok: true, available: true }, 200);

    if (url.pathname === "/api/cashout/session" && request.method === "POST") {
      const body = await readJson(request);
      const amount = body?.cryptoAmount;
      // Whole cents only, positive, under the ceiling. Anything else is refused before Transak is called.
      const cents = typeof amount === "number" ? Math.round(amount * 100) : NaN;
      if (typeof amount !== "number" || !Number.isFinite(amount) || cents <= 0 || cents > MAX_USDC * 100 || Math.abs(cents - amount * 100) > 1e-6) {
        return reply({ ok: false, code: "BAD_REQUEST", message: "cryptoAmount must be a positive amount in whole cents, at most 500." }, 400);
      }
      const call = async (force: boolean) =>
        fetch(`${b.gateway}/api/v2/auth/session`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.TRANSAK_API_KEY!, "access-token": await accessToken(env, b, force), "x-user-ip": ip },
          body: JSON.stringify({
            widgetParams: {
              apiKey: env.TRANSAK_API_KEY,
              referrerDomain: env.TRANSAK_REFERRER ?? "orventyield.tech",
              productsAvailed: "SELL",
              cryptoCurrencyCode: "USDC",
              network: "arbitrum",
              cryptoAmount: cents / 100, // fixed: the user cannot change it in the widget
            },
          }),
        });
      let res = await call(false);
      if (res.status === 401) res = await call(true); // token may have been rotated
      const j = (await res.json().catch(() => ({}))) as { data?: { widgetUrl?: string } };
      const widgetUrl = j.data?.widgetUrl;
      if (!res.ok || typeof widgetUrl !== "string") return reply({ ok: false, code: "UPSTREAM", message: "The cashout provider had a problem. Nothing was sent." }, 502);
      let host = "";
      try {
        const u = new URL(widgetUrl);
        host = u.protocol === "https:" ? u.hostname : "";
      } catch {
        /* invalid */
      }
      if (!WIDGET_HOSTS.includes(host)) return reply({ ok: false, code: "UPSTREAM", message: "The cashout provider sent an unexpected link, so we stopped." }, 502);
      return reply({ ok: true, session: { widgetUrl } }, 200);
    }

    const m = /^\/api\/cashout\/order\/([^/]+)$/.exec(url.pathname);
    if (m && request.method === "GET") {
      const id = decodeURIComponent(m[1]!);
      if (!ORDER_ID.test(id)) return reply({ ok: false, code: "BAD_REQUEST", message: "Invalid order id." }, 400);
      const call = async (force: boolean) =>
        fetch(`${b.partners}/partners/api/v2/order/${id}`, { headers: { "x-api-key": env.TRANSAK_API_KEY!, "access-token": await accessToken(env, b, force), accept: "application/json" } });
      let res = await call(false);
      if (res.status === 401) res = await call(true);
      if (res.status === 404) return reply({ ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." }, 404);
      const j = (await res.json().catch(() => ({}))) as { data?: unknown };
      if (!res.ok || !j.data) return reply({ ok: false, code: "UPSTREAM", message: "The cashout provider had a problem. Nothing was sent." }, 502);
      return reply({ ok: true, order: normalizeOrder(j.data, env.TRANSAK_DEPOSIT_FIELD) }, 200);
    }

    return reply({ ok: false, code: "NOT_FOUND", message: "Not found." }, 404);
  } catch {
    return reply({ ok: false, code: "UPSTREAM", message: "The cashout provider had a problem. Nothing was sent." }, 502);
  }
}
