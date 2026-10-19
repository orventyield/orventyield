import { describe, expect, it, vi } from "vitest";
import { ImmersveClient, ImmersveError, maskPan, readiness } from "../../src/lib/immersve";
import { immersveConfig } from "../../src/lib/immersve/config";

const cfg = immersveConfig({});
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function client(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url.replace(cfg.baseUrl, "")}`;
    const h = routes[key];
    if (!h) throw new Error(`unrouted ${key}`);
    return h(init);
  });
  return { c: new ImmersveClient(cfg, f as unknown as typeof fetch), calls };
}

const loginRoutes = {
  "POST /auth/login-init": () => ok({ id: "req1", signingChallenge: { message: "sign me" } }),
  "POST /auth/login-complete": () => ok({ accessToken: "AT", refreshToken: "RT", cardholderAccountId: "acc1" }),
};

describe("Immersve client", () => {
  it("defaults to the public sandbox and lets env override", () => {
    expect(cfg.baseUrl).toBe("https://test.immersve.com");
    expect(immersveConfig({ NEXT_PUBLIC_IMMERSVE_BASE_URL: "https://api.immersve.com" }).baseUrl).toBe("https://api.immersve.com");
  });

  it("refuses authenticated calls before login", async () => {
    const { c } = client({});
    await expect(c.listFundingSources()).rejects.toMatchObject({ errorCode: "NOT_LOGGED_IN" });
  });

  it("logs in with a signed SIWE challenge and then sends the bearer token", async () => {
    const { c, calls } = client({ ...loginRoutes, "GET /api/accounts/acc1/funding-sources": () => ok({ items: [] }) });
    const sign = vi.fn(async () => "0xsig");
    await c.login("0xabc", "https://orventyield.tech", sign);
    expect(sign).toHaveBeenCalledWith("sign me");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ loginRequestId: "req1", signature: "0xsig" });
    await c.listFundingSources();
    expect((calls[2]!.init.headers as Record<string, string>).authorization).toBe("Bearer AT");
    c.logout();
    expect(c.isLoggedIn).toBe(false);
  });

  it("reuses an existing funding source instead of creating a duplicate", async () => {
    const fs = { id: "fs1", accountId: "acc1", fundingChannelId: cfg.fundingChannelId, balance: "0", balanceCurrency: "USDC" };
    const { c, calls } = client({ ...loginRoutes, "GET /api/accounts/acc1/funding-sources": () => ok({ items: [fs] }) });
    await c.login("0xabc", "https://x.y", async () => "0xs");
    expect((await c.ensureFundingSource("0xabc")).id).toBe("fs1");
    expect(calls.some((x) => x.init.method === "POST" && x.url.endsWith("/api/funding-sources"))).toBe(false);
  });

  it("surfaces errorCode (e.g. KYC_REQUIRED) as ImmersveError", async () => {
    const { c } = client({ ...loginRoutes, "POST /api/cards": () => ok({ errorCode: "KYC_REQUIRED" }, 403) });
    await c.login("0xabc", "https://x.y", async () => "0xs");
    await expect(c.createCard("fs1")).rejects.toMatchObject({ status: 403, errorCode: "KYC_REQUIRED" });
  });

  it("survives a non-JSON gateway 403", async () => {
    const { c } = client({ ...loginRoutes, "POST /api/spending-prerequisites": () => new Response("<html>403</html>", { status: 403 }) });
    await c.login("0xabc", "https://x.y", async () => "0xs");
    await expect(c.spendingPrerequisites("fs1", 100, "http://localhost:3000")).rejects.toBeInstanceOf(ImmersveError);
  });

  it("reveals card secrets via pan-token then the single-use callback", async () => {
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/auth/login-init")) return ok({ id: "r", signingChallenge: { message: "m" } });
      if (url.endsWith("/auth/login-complete")) return ok({ accessToken: "AT", refreshToken: "RT", cardholderAccountId: "acc1" });
      if (url.endsWith("/api/cards/c1/pan-token")) return ok({ tokenId: "t", callbackUrl: "https://secure.example/cb" }, 201);
      if (url === "https://secure.example/cb") return ok({ pan: "5288541234561179", expiry: "203006", cvv2: "123", embossedName: "A B" });
      throw new Error(`unrouted ${init.method} ${url}`);
    });
    const c = new ImmersveClient(cfg, f as unknown as typeof fetch);
    await c.login("0xabc", "https://x.y", async () => "0xs");
    expect(await c.revealCard("c1")).toEqual({ pan: "5288541234561179", expiry: "203006", cvv2: "123", embossedName: "A B" });
  });

  it("rejects a reveal response that lacks a PAN", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/login-init")) return ok({ id: "r", signingChallenge: { message: "m" } });
      if (url.endsWith("/auth/login-complete")) return ok({ accessToken: "AT", refreshToken: "RT", cardholderAccountId: "a" });
      if (url.endsWith("/pan-token")) return ok({ callbackUrl: "https://s/cb" }, 201);
      return ok({ expiry: "203006", cvv2: "1" });
    });
    const c = new ImmersveClient(cfg, f as unknown as typeof fetch);
    await c.login("0x1", "https://x.y", async () => "0xs");
    await expect(c.revealCard("c1")).rejects.toMatchObject({ errorCode: "BAD_RESPONSE" });
  });
});

describe("readiness", () => {
  it("is ready only when every stage is ok", () => {
    expect(readiness([{ stage: "kyc", status: "ok" }, { stage: "aml", status: "ok" }, { stage: "funding", status: "ok" }])).toEqual({ state: "ready" });
    expect(readiness([])).toEqual({ state: "ready" });
  });
  it("asks for KYC with the link, and shows pending while checks run", () => {
    expect(readiness([{ stage: "kyc", status: "action-required", actionType: "follow_kyc_url", params: { kycUrl: "https://v/k" } }])).toEqual({ state: "kyc-required", kycUrl: "https://v/k" });
    expect(readiness([{ stage: "kyc", status: "pending" }])).toEqual({ state: "pending" });
    expect(readiness([{ stage: "kyc", status: "ok" }, { stage: "aml", status: "pending" }])).toEqual({ state: "pending" });
  });
  it("falls back to pending (not a dead link) when KYC has no url", () => {
    expect(readiness([{ stage: "kyc", status: "action-required" }])).toEqual({ state: "pending" });
  });
  it("needs funding last", () => {
    expect(readiness([{ stage: "kyc", status: "ok" }, { stage: "funding", status: "action-required" }])).toEqual({ state: "funding-required" });
  });
});

describe("maskPan", () => {
  it("keeps only first 6 and last 4", () => {
    expect(maskPan("5288541234561179")).toBe("528854******1179");
    expect(maskPan("123")).toBe("****");
  });
});
