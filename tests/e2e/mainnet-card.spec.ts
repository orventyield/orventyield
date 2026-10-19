import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * The Mainnet Card tab end to end on the Anvil fork: deposit -> yield -> phone OTP (browser demo verifier) -> card issuer
 * session -> KYC -> issue -> Mastercard -> single-use PAN/CVV reveal -> allowance = live yield.
 * The card issuer (Immersve sandbox) is mocked at the network layer: tests never depend on its uptime, and its KYC step
 * needs a human with a camera. The real sandbox is exercised by `node scripts/immersve-sandbox.mjs`.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const KYC_URL = "https://verify.test.immersve.com/kyc/session/e2e";
const PAN = "5288541234561179";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function installForkWallet(page: Page) {
  await page.addInitScript(
    ({ account, fork }) => {
      const info = { uuid: "00000000-0000-4000-8000-0000000000f2", name: "Anvil Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.anvil.wallet" };
      const call = (method: string, params: unknown[]) =>
        fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) })
          .then((r) => r.json())
          .then((j) => {
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          });
      let authorized = false;
      const w = window as unknown as { __rejectSign?: boolean };
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") {
            authorized = true;
            return [account];
          }
          if (method === "eth_accounts") return authorized ? [account] : [];
          if (method === "eth_chainId") return "0x7a69";
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "personal_sign" && w.__rejectSign) {
            w.__rejectSign = false;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          return call(method, params ?? []);
        },
        on() {},
        removeListener() {},
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account: ACCOUNT, fork: FORK },
  );
}

interface Issuer {
  kycDone: boolean;
  issued: boolean;
  revealCalls: number;
  tokensIssued: number;
  logins: number;
  spendableAmounts: number[];
}

/** A stateful stand-in for the card issuer. The test flips `kycDone` the way a human finishing KYC would. */
async function mockIssuer(page: Page): Promise<Issuer> {
  const st: Issuer = { kycDone: false, issued: false, revealCalls: 0, tokensIssued: 0, logins: 0, spendableAmounts: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST" };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

  await page.route("https://test.immersve.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : {};
    if (path === "/auth/login-init") return json(route, { id: "req1", signingChallenge: { message: "orventyield.tech wants you to sign in (e2e)" } });
    if (path === "/auth/login-complete") {
      st.logins++;
      return json(route, { accessToken: "AT", refreshToken: "RT", cardholderAccountId: "acc1" });
    }
    if (path === "/api/accounts/acc1/funding-sources") return json(route, { items: [] });
    if (path === "/api/funding-sources") return json(route, { id: "fs1", accountId: "acc1", fundingChannelId: body.fundingChannelId, balance: "0", balanceCurrency: "USDC" });
    if (path === "/api/spending-prerequisites") {
      st.spendableAmounts.push(Number(body.spendableAmount));
      expect(String(body.kycRedirectUrl).startsWith("https://")).toBe(true); // the gateway rejects http://localhost
      return json(route, {
        prerequisites: st.kycDone
          ? [{ stage: "aml", status: "ok", params: {} }, { stage: "kyc", status: "ok", params: {} }]
          : [{ stage: "aml", status: "pending", params: {} }, { stage: "kyc", status: "action-required", actionType: "follow_kyc_url", params: { kycUrl: KYC_URL } }],
      });
    }
    if (path === "/api/accounts/acc1/cards") {
      return json(route, { items: st.issued ? [{ id: "c1", type: "virtual", network: "simulator", status: "active", isBlocked: false, expiry: "203006", panFirst6: "528854", panLast4: "1179", regionCode: "NZ", cardholderName: "E2E TESTER" }] : [] });
    }
    if (path === "/api/cards" && req.method() === "POST") {
      if (!st.kycDone) return json(route, { errorCode: "KYC_REQUIRED" }, 403);
      st.issued = true;
      return json(route, { cardId: "c1" });
    }
    if (path === "/api/cards/c1/pan-token") {
      st.tokensIssued++;
      return json(route, { tokenId: `t${st.tokensIssued}`, callbackUrl: `https://secure.test.immersve.com/reveal/${st.tokensIssued}` }, 201);
    }
    return json(route, { errorCode: "UNMOCKED", path }, 404);
  });
  // The single-use reveal link: first use works, any reuse is a 403, exactly like the real service.
  const used = new Set<string>();
  await page.route("https://secure.test.immersve.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const id = new URL(route.request().url()).pathname;
    if (used.has(id)) return json(route, { errorCode: "FORBIDDEN" }, 403);
    used.add(id);
    st.revealCalls++;
    return json(route, { pan: PAN, expiry: "203006", cvv2: "123", embossedName: "E2E TESTER" });
  });
  return st;
}

async function verifyPhone(page: Page, code = "123456") {
  await page.getByTestId("card-verify-phone").click();
  await page.getByTestId("phone-country").selectOption("IN");
  await page.getByTestId("phone-input").fill("98765 43210");
  await page.getByTestId("phone-submit").click();
  await page.getByTestId("otp-input").fill(code);
  await expect(page.getByTestId("otp-dialog")).toHaveCount(0, { timeout: 15_000 });
}

test.describe("mainnet card suite", () => {
  test.describe.configure({ mode: "serial" });
  let snapshot: string;

  test.beforeAll(async () => {
    test.skip(((await rpc<string>("eth_chainId").catch(() => null)) as string | null) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterAll(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("phone OTP -> issuer sign-in -> KYC -> card -> single-use reveal -> allowance equals live yield", async ({ page, context }) => {
    test.setTimeout(180_000); // real transactions, a yield refresh and polling
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const issuer = await mockIssuer(page);
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });

    // Real money first: 1,000 USDC into the Safe, then 30 days of yield on the fork.
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");

    // Step 1: phone first. Nothing of the issuer is touched before this is done.
    await page.getByTestId("tab-card").click();
    await expect(page.getByTestId("card-step-phone")).toBeVisible();
    expect(issuer.logins).toBe(0);
    await verifyPhone(page);

    // Step 2: free wallet signature. A rejection is explained and nothing is lost.
    await expect(page.getByTestId("card-step-login")).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __rejectSign: boolean }).__rejectSign = true));
    await page.getByTestId("card-continue").click();
    await expect(page.getByTestId("card-error")).toContainText("cancelled");
    expect(issuer.logins).toBe(0);
    await page.getByTestId("card-continue").click();

    // Step 3: KYC opens the issuer's page in a new tab; finishing it moves this page on by itself.
    await expect(page.getByTestId("card-step-kyc")).toBeVisible({ timeout: 20_000 });
    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("card-start-kyc").click()]);
    expect(popup.url()).toContain("verify.test.immersve.com/kyc/session/e2e");
    await popup.close();
    issuer.kycDone = true;
    await expect(page.getByTestId("card-step-issue")).toBeVisible({ timeout: 30_000 });

    // Step 4: issue and show a Mastercard with only the safe parts visible
    await page.getByTestId("card-issue").click();
    await expect(page.getByTestId("card-active")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("virtual-card")).toBeVisible();
    await expect(page.getByRole("img", { name: "Mastercard" }).first()).toBeVisible();
    await expect(page.getByTestId("card-pan")).toHaveText("5288 54•• •••• 1179");
    await expect(page.getByTestId("card-cvv")).toHaveText("•••");
    await expect(page.getByTestId("card-expiry")).toHaveText("06/30");

    // Step 5: single-use reveal. Every reveal asks for a fresh link; the PAN never lands in storage.
    await page.getByTestId("card-reveal").click();
    await expect(page.getByTestId("card-pan")).toHaveText("5288 5412 3456 1179");
    if (process.env.SHOT) await page.screenshot({ path: "/tmp/oy-card.png" });
    await expect(page.getByTestId("card-cvv")).toHaveText("123");
    await expect(page.getByTestId("card-hide")).toContainText(/\(\d+s\)/); // the auto-hide countdown is shown
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain(PAN);
    expect(stored).not.toContain("5288541234561179");
    await page.getByTestId("card-hide").click();
    await expect(page.getByTestId("card-pan")).toHaveText("5288 54•• •••• 1179");
    await expect(page.getByTestId("card-cvv")).toHaveText("•••");
    await page.getByTestId("card-reveal").click(); // a second reveal must use a NEW one-time link
    await expect(page.getByTestId("card-cvv")).toHaveText("123");
    expect(issuer.tokensIssued).toBe(2);
    expect(issuer.revealCalls).toBe(2);
    await page.getByTestId("card-hide").click();

    // Step 6: the allowance is the live yield (30 days on 1,000 USDC is well over $1), never principal
    await expect.poll(async () => Number(((await page.getByTestId("card-allowance").textContent()) ?? "").replace(/[^0-9.]/g, "")), { timeout: 60_000 }).toBeGreaterThan(1);
    const allowance = Number(((await page.getByTestId("card-allowance").textContent()) ?? "").replace(/[^0-9.]/g, ""));
    expect(allowance).toBeLessThan(10); // far below the $1,000 principal
    expect(Math.max(...issuer.spendableAmounts)).toBeGreaterThanOrEqual(100); // never declares under $1.00
    expect(errors).toEqual([]);
  });
});
