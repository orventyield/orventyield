import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Bank / UPI cashout on the Anvil fork: real deposit and yield, then a cashout paid from yield by a real Safe transaction.
 * The Worker (Transak proxy) and Transak's widget page are mocked at the network layer: the real ones need a partner key and
 * the SELL widget needs a human with KYC. What is proven here: the amount is locked to earned yield, the order is verified,
 * and exactly that much USDC leaves the Safe (principal untouched). Not proven: Transak's real order schema (see worker/transak.ts).
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const API = "https://vouchers.e2e.test";
const DEPOSIT_TO = "0x7a5a1e0000000000000000000000000000c0ffe3";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const usdcOf = async (a: string) => BigInt(await rpc<string>("eth_call", [{ to: USDC, data: `0x70a08231${a.toLowerCase().replace("0x", "").padStart(64, "0")}` }, "latest"]));

async function installForkWallet(page: Page) {
  await page.addInitScript(
    ({ account, fork }) => {
      const info = { uuid: "00000000-0000-4000-8000-0000000000f4", name: "Anvil Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.anvil.wallet" };
      const call = (method: string, params: unknown[]) =>
        fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) })
          .then((r) => r.json())
          .then((j) => {
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          });
      let authorized = false;
      const w = window as unknown as { __rejectNext?: boolean };
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") { authorized = true; return [account]; }
          if (method === "eth_accounts") return authorized ? [account] : [];
          if (method === "eth_chainId") return "0x7a69";
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_sendTransaction" && w.__rejectNext) {
            w.__rejectNext = false;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          return call(method, params ?? []);
        },
        on() {}, removeListener() {},
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account: ACCOUNT, fork: FORK },
  );
}

interface Mock {
  sessions: number[];
  orderStatus: string;
  /** Added to the order's crypto amount, to simulate a provider that asks for a different amount. */
  amountDelta: number;
  network: string;
  orderCalls: number;
}

async function mockProvider(page: Page): Promise<Mock> {
  const st: Mock = { sessions: [], orderStatus: "AWAITING_PAYMENT_FROM_USER", amountDelta: 0, network: "arbitrum", orderCalls: 0 };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    if (path === "/api/cashout/status") return json(route, { ok: true, available: true });
    if (path === "/api/cashout/session") {
      st.sessions.push(JSON.parse(req.postData() ?? "{}").cryptoAmount);
      return json(route, { ok: true, session: { widgetUrl: "https://global-stg.transak.com/?apiKey=e2e&sessionId=s1" } });
    }
    if (path.startsWith("/api/cashout/order/")) {
      st.orderCalls++;
      const asked = st.sessions.at(-1) ?? 0;
      return json(route, { ok: true, order: { id: "ord-e2e-12345", status: st.orderStatus, side: "SELL", cryptoAmount: (asked + st.amountDelta).toFixed(2), currency: "USDC", network: st.network, depositAddress: DEPOSIT_TO, fiatAmount: 155, fiatCurrency: "INR" } });
    }
    return json(route, { ok: false, code: "UNMOCKED" }, 404);
  });
  // A stand-in for Transak's widget page. It emits the documented TRANSAK_ORDER_CREATED event to its parent.
  await page.route("https://global-stg.transak.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><body style="font:14px sans-serif;background:#fff"><h1>Fake Transak</h1><button id="b">Create order</button>
<script>document.getElementById('b').onclick=()=>parent.postMessage({event_id:'TRANSAK_ORDER_CREATED',data:{id:'ord-e2e-12345'}},'*');</script></body>`,
    }),
  );
  return st;
}

async function depositAndEarn(page: Page) {
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("open-deposit").click();
  await page.getByTestId("amount-input").fill("1000");
  await page.getByTestId("amount-confirm").click();
  await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
  await rpc("evm_increaseTime", [30 * 24 * 3600]);
  await rpc("evm_mine");
  await page.getByTestId("tab-cashout").click();
  await expect(page.getByTestId("cashout-panel")).toBeVisible();
  await expect.poll(async () => Number(((await page.getByTestId("cashout-yield").textContent()) ?? "").replace(/[^0-9.]/g, "")), { timeout: 60_000 }).toBeGreaterThan(1);
}

const openWidget = async (page: Page) => {
  await page.getByTestId("co-max").click();
  await page.getByTestId("co-start").click();
  await expect(page.getByTestId("co-frame")).toBeVisible({ timeout: 20_000 });
  await page.frameLocator('[data-testid="co-frame"]').getByRole("button", { name: "Create order" }).click();
};

test.describe("mainnet bank / UPI cashout", () => {
  test.describe.configure({ mode: "serial" });
  let snapshot: string;
  test.beforeAll(async () => {
    test.skip(((await rpc<string>("eth_chainId").catch(() => null)) as string | null) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
  });
  test.beforeEach(async () => { snapshot = await rpc<string>("evm_snapshot"); });
  test.afterEach(async () => { if (snapshot) await rpc("evm_revert", [snapshot]); });

  test("amount is locked to earned yield, the order is verified, and exactly that USDC leaves the Safe", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const mock = await mockProvider(page);
    await depositAndEarn(page);

    // The amount can never exceed the earned yield
    await page.getByTestId("co-amount").fill("500");
    await expect(page.getByTestId("co-over")).toBeVisible();
    await expect(page.getByTestId("co-start")).toBeDisabled();

    await openWidget(page);
    // The widget got a FIXED amount: whole cents, no more than the yield (30 days on 1,000 USDC is under $2)
    expect(mock.sessions).toHaveLength(1);
    expect(mock.sessions[0]).toBeGreaterThan(1);
    expect(mock.sessions[0]).toBeLessThan(2.5);
    expect(Math.abs(mock.sessions[0]! * 100 - Math.round(mock.sessions[0]! * 100))).toBeLessThan(1e-6);
    await expect(page.getByTestId("co-locked")).toHaveText(`${mock.sessions[0]!.toFixed(2)} USDC`);

    // The order is read from OUR server, verified, and shown before anything is sent
    await expect(page.getByTestId("co-confirm")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("co-send")).toHaveText(`${mock.sessions[0]!.toFixed(2)} USDC`);
    await expect(page.getByTestId("co-to")).toHaveText(new RegExp(`^${DEPOSIT_TO}$`, "i")); // shown checksummed
    expect(await usdcOf(DEPOSIT_TO)).toBe(0n);

    // A rejected wallet prompt sends nothing and keeps the order payable
    await page.evaluate(() => ((window as unknown as { __rejectNext: boolean }).__rejectNext = true));
    await page.getByTestId("co-pay").click();
    await expect(page.getByTestId("co-tx-error")).toContainText("cancelled", { timeout: 30_000 });
    expect(await usdcOf(DEPOSIT_TO)).toBe(0n);

    await page.getByTestId("co-pay").click();
    await expect(page.getByTestId("co-sent")).toBeVisible({ timeout: 90_000 });
    // On-chain truth: exactly the locked cents reached the provider; the principal line did not move
    const want = BigInt(Math.round(mock.sessions[0]! * 100)) * 10_000n;
    expect(await usdcOf(DEPOSIT_TO)).toBe(want);

    // Payout completes
    mock.orderStatus = "COMPLETED";
    await expect(page.getByTestId("co-done")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("co-done")).toContainText("155 INR");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByTestId("tab-vault").click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00");
    await page.getByTestId("tab-activity").click();
    await expect(page.getByTestId("ledger-row").filter({ hasText: "Yield withdrawn" })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  for (const [name, patch] of [
    ["an order for a different amount", { amountDelta: 0.01 }],
    ["an order on a different network", { network: "ethereum" }],
    ["an order that is no longer awaiting payment", { orderStatus: "EXPIRED" }],
  ] as const) {
    test(`refuses ${name} and sends nothing`, async ({ page }) => {
      test.setTimeout(180_000);
      const mock = await mockProvider(page);
      Object.assign(mock, patch);
      await depositAndEarn(page);
      await openWidget(page);
      await expect(page.getByTestId("co-failed")).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId("co-pay")).toHaveCount(0);
      expect(await usdcOf(DEPOSIT_TO)).toBe(0n);
    });
  }

  test("a widget message from another origin is ignored", async ({ page }) => {
    test.setTimeout(180_000);
    const mock = await mockProvider(page);
    await depositAndEarn(page);
    await page.getByTestId("co-max").click();
    await page.getByTestId("co-start").click();
    await expect(page.getByTestId("co-frame")).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => window.postMessage({ event_id: "TRANSAK_ORDER_CREATED", data: { id: "ord-e2e-12345" } }, "*")); // from the page itself, not the widget frame
    await page.waitForTimeout(1500);
    expect(mock.orderCalls).toBe(0);
    await expect(page.getByTestId("co-confirm")).toHaveCount(0);
  });
});
