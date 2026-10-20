/**
 * The same flows against the REAL verification Worker (wrangler dev, local D1, mock OTP provider with code 123456).
 * Run with `API=1 npm run e2e`. The web app under test (port 3200) is built with NEXT_PUBLIC_VERIFY_API_URL set.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { validateE164 } from "../../src/lib/identity/phone";
import { DEMO_CODE, installMockWallet, pickCountry } from "./helpers";

const API = "http://localhost:8787";
const FORK_RPC = "http://127.0.0.1:8545";
const WEB_ORIGIN = "http://localhost:3200";
let ipSeq = 0;
const nextIp = () => `198.51.100.${(++ipSeq % 250) + 1}.`.replace(/\.$/, "");

/** A valid Indian mobile number nobody has used in this run. */
function freshPhone(): { national: string; e164: string } {
  for (;;) {
    const national = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const r = validateE164(`+91${national}`);
    if (r.ok) return { national, e164: r.e164 };
  }
}

async function newWalletPage(browser: Browser) {
  const account = privateKeyToAccount(generatePrivateKey());
  const ctx = await browser.newContext({ baseURL: WEB_ORIGIN });
  const page = await ctx.newPage();
  const ip = nextIp();
  // Local stand-in for Cloudflare setting CF-Connecting-IP: gives each "user" their own rate-limit bucket.
  await page.route(`${API}/**`, (route) => route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": ip } }));
  await installMockWallet(page, account.address, (message) => account.signMessage({ message }), "0x7a69", FORK_RPC);
  return { account, ctx, page, ip };
}

async function connectWallet(page: Page) {
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.wallet").click();
  await expect(page.getByTestId("account-button")).toBeVisible();
  // Phone verification lives in the Mainnet Card step; the connected wallet lands there.
  await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
}

async function fillPhone(page: Page, national: string) {
  await page.getByTestId("card-verify-phone").click();
  await pickCountry(page, "IN");
  await page.getByTestId("phone-input").fill(national);
  await page.getByTestId("phone-submit").click();
}

test.describe("verification through the real API", () => {
  test("a wallet verifies its phone, signs the activation message, and stays unlocked in a fresh session", async ({ browser }) => {
    const w = await newWalletPage(browser);
    const phone = freshPhone();
    const bodies: string[] = [];
    w.page.on("response", async (r) => {
      if (r.url().startsWith(`${API}/api/verify/`)) bodies.push(await r.text().catch(() => ""));
    });

    await connectWallet(w.page);
    await expect(w.page.getByTestId("card-verify-phone")).toBeVisible();
    await fillPhone(w.page, phone.national);
    await expect(w.page.getByTestId("otp-step")).toBeVisible();
    await expect(w.page.getByTestId("otp-hint")).toHaveCount(0); // real API: no demo-code hint
    await w.page.getByTestId("otp-input").fill(DEMO_CODE);
    await expect(w.page.getByTestId("card-step-login")).toBeVisible();

    // Privacy: the service only ever echoes a masked number.
    const all = bodies.join("\n");
    expect(all).toContain("••••");
    expect(all).not.toContain(phone.national);
    expect(all).not.toContain(phone.e164);

    // A brand-new browser profile with the same wallet: status comes from the server, no OTP needed.
    const again = await browser.newContext({ baseURL: WEB_ORIGIN });
    const p2 = await again.newPage();
    await p2.route(`${API}/**`, (route) => route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": w.ip } }));
    await installMockWallet(p2, w.account.address, (message) => w.account.signMessage({ message }), "0x7a69", FORK_RPC);
    await connectWallet(p2);
    await expect(p2.getByTestId("card-step-login")).toBeVisible({ timeout: 15_000 });
    await w.ctx.close();
    await again.close();
  });

  test("a second wallet with an already-verified phone signs in: OTP + signature move the card, the first wallet is signed out", async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await newWalletPage(browser);
    const b = await newWalletPage(browser);
    const phone = freshPhone();

    await connectWallet(a.page);
    await fillPhone(a.page, phone.national);
    await a.page.getByTestId("otp-input").fill(DEMO_CODE);
    await expect(a.page.getByTestId("card-step-login")).toBeVisible();

    await connectWallet(b.page);
    await expect(b.page.getByTestId("card-verify-phone")).toBeVisible();
    await b.page.waitForTimeout(31_000); // the real Worker keeps a 30s resend cooldown per phone
    await fillPhone(b.page, phone.national);
    await expect(b.page.getByTestId("dup-error")).toHaveCount(0);
    await expect(b.page.getByTestId("relink-note")).toBeVisible();
    await b.page.getByTestId("otp-input").fill(DEMO_CODE);
    await expect(b.page.getByTestId("otp-dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(b.page.getByTestId("card-step-login")).toBeVisible();

    // One holder per phone: the first wallet no longer has the card
    await a.page.reload();
    await connectWallet(a.page);
    await expect(a.page.getByTestId("card-verify-phone")).toBeVisible({ timeout: 15_000 });
    await a.ctx.close();
    await b.ctx.close();
  });

  test("a wallet that already has a card cannot create another with a different phone", async ({ browser, request }) => {
    const a = await newWalletPage(browser);
    await connectWallet(a.page);
    await fillPhone(a.page, freshPhone().national);
    await a.page.getByTestId("otp-input").fill(DEMO_CODE);
    await expect(a.page.getByTestId("card-step-login")).toBeVisible();

    const res = await request.post(`${API}/api/verify/start`, {
      headers: { "content-type": "application/json", "cf-connecting-ip": nextIp() },
      data: { phone: freshPhone().e164, owner: a.account.address },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "OWNER_ALREADY_HAS_CARD", message: "This account already has an active card." });
    await a.ctx.close();
  });

  test("nobody can bind a victim's wallet address to their own phone without the wallet's signature", async ({ request }) => {
    const victim = privateKeyToAccount(generatePrivateKey()).address;
    const phone = freshPhone().e164;
    const ip = nextIp();
    const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
    const start = await (await request.post(`${API}/api/verify/start`, { headers, data: { phone, owner: victim } })).json();
    expect(start.messageToSign).toContain("Signing proves you own this wallet");

    const noSig = await request.post(`${API}/api/verify/check`, { headers, data: { phone, owner: victim, nonce: start.nonce, code: DEMO_CODE } });
    expect(noSig.status()).toBe(401);
    const forged = await request.post(`${API}/api/verify/check`, { headers, data: { phone, owner: victim, nonce: start.nonce, code: DEMO_CODE, signature: `0x${"11".repeat(65)}` } });
    expect(forged.status()).toBe(401);

    const status = await (await request.get(`${API}/api/verify/status?owner=${victim}`, { headers })).json();
    expect(status.active).toBe(false);
  });

  test("OTP requests are rate limited per IP with a Retry-After header", async ({ request }) => {
    const headers = { "content-type": "application/json", "cf-connecting-ip": nextIp() };
    const owner = () => `guest:${Math.random().toString(36).slice(2).padEnd(16, "x")}`;
    const codes: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < 7; i++) {
      const r = await request.post(`${API}/api/verify/start`, { headers, data: { phone: freshPhone().e164, owner: owner() } });
      codes.push(r.status());
      if (r.status() === 429) retryAfter = r.headers()["retry-after"];
    }
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThan(0);

    const other = await request.post(`${API}/api/verify/start`, { headers: { ...headers, "cf-connecting-ip": nextIp() }, data: { phone: freshPhone().e164, owner: owner() } });
    expect(other.status()).toBe(200);
  });

  test("CORS: only the app's origins are allowed", async ({ request }) => {
    const ok = await request.fetch(`${API}/api/health`, { headers: { origin: WEB_ORIGIN } });
    expect(ok.headers()["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    const evil = await request.fetch(`${API}/api/health`, { headers: { origin: "https://evil.example" } });
    expect(evil.headers()["access-control-allow-origin"]).toBeUndefined();
  });
});
