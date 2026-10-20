import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * The Mainnet Vouchers tab on the Anvil fork: real deposit and yield, then a voucher paid from yield by a real Safe
 * transaction. The voucher Worker (Bitrefill proxy) is mocked at the network layer, because it needs a provider key and
 * spends real money. The Worker itself is covered by unit tests; run it against Bitrefill manually with a real key.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const API = "https://vouchers.e2e.test";
const INVOICE_ADDR = "0xb0b0000000000000000000000000000000000b0b";
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
      const info = { uuid: "00000000-0000-4000-8000-0000000000f3", name: "Anvil Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.anvil.wallet" };
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
          if (method === "eth_requestAccounts") {
            authorized = true;
            return [account];
          }
          if (method === "eth_accounts") return authorized ? [account] : [];
          if (method === "eth_chainId") return "0x7a69";
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_sendTransaction" && w.__rejectNext) {
            w.__rejectNext = false;
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

interface Shop {
  catalogFailuresLeft: number;
  nextPrice: number;
  invoices: number;
  polls: number;
  delivered: boolean;
}

const product = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ brand: id, productId: id, name, countryCode: "US", currency: "USD", packages: [{ id: 1, value: 5 }, { id: 2, value: 10 }], ...extra });

async function mockShop(page: Page): Promise<Shop> {
  const st: Shop = { catalogFailuresLeft: 1, nextPrice: 1.5, invoices: 0, polls: 0, delivered: false };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    if (u.pathname === "/api/vouchers/catalog") {
      if (st.catalogFailuresLeft-- > 0) return json(route, { ok: false, code: "UPSTREAM_500", message: "The voucher provider had a problem. Nothing was charged." }, 502);
      return json(route, { ok: true, products: [product("amazon", "Amazon US"), product("swiggy", "Swiggy"), product("zomato", "Zomato"), product("uber", "Uber", { packages: [], range: { min: 10, max: 100, step: 5 } })] });
    }
    if (u.pathname === "/api/vouchers/invoice" && req.method() === "POST") {
      st.invoices++;
      const body = JSON.parse(req.postData() ?? "{}");
      expect(body.refundAddress.toLowerCase()).toBe(ACCOUNT.toLowerCase()); // refunds go to the user's wallet
      return json(route, { ok: true, quote: { invoiceId: `inv_e2e_${st.invoices}`, address: INVOICE_ADDR, price: st.nextPrice, currency: "USDC" } });
    }
    if (u.pathname.startsWith("/api/vouchers/invoice/")) {
      st.polls++;
      const delivered = st.delivered || st.polls >= 2; // first poll: still processing
      st.delivered = delivered;
      return json(route, {
        ok: true,
        status: delivered
          ? { invoiceId: "inv_e2e_1", state: "delivered", rawStatus: "complete", redemptions: [{ code: "SWIG-TEST-1234", pin: "4321", instructions: "Enter the code in the app.", expirationDate: "2027-12-31" }] }
          : { invoiceId: "inv_e2e_1", state: "processing", rawStatus: "not_delivered", redemptions: [] },
      });
    }
    return json(route, { ok: false, code: "UNMOCKED" }, 404);
  });
  return st;
}

test("an older server without voucher routes shows a calm 'coming soon', not an error", async ({ page }) => {
  test.skip(((await rpc<string>("eth_chainId").catch(() => null)) as string | null) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
  await page.route(`${API}/**`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" } })
      : route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ ok: false, code: "NOT_FOUND", message: "Not found." }) }),
  );
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tab-vouchers").click();
  await expect(page.getByTestId("voucher-unavailable")).toContainText("being switched on");
  await expect(page.getByTestId("voucher-catalog-error")).toHaveCount(0);
  await expect(page.getByText("Not found.")).toHaveCount(0);
});

test.describe("mainnet vouchers", () => {
  test.describe.configure({ mode: "serial" });
  let snapshot: string;

  test.beforeAll(async () => {
    test.skip(((await rpc<string>("eth_chainId").catch(() => null)) as string | null) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterAll(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("brand list, exact price, pay from yield by a real Safe transaction, delivery, and principal untouched", async ({ page }) => {
    test.setTimeout(180_000); // real transactions plus a 30s yield refresh
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => process.env.DBG && console.log("[browser]", m.type(), m.text().slice(0, 300)));
    const shop = await mockShop(page);
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });

    // Real deposit, then 30 days of yield on the fork
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");

    // Catalogue: a failure is explained and retryable; then the four brands appear
    await page.getByTestId("tab-vouchers").click();
    await expect(page.getByTestId("voucher-catalog-error")).toContainText("Nothing was charged");
    await page.getByRole("button", { name: "Try again" }).click();
    for (const b of ["amazon", "swiggy", "zomato", "uber"]) await expect(page.getByTestId(`brand-${b}`)).toBeVisible();
    await expect(page.getByText("Netflix")).toHaveCount(0);

    // The yield shown is real (30 days on 1,000 USDC) and wait for the dashboard to pick it up
    await expect.poll(async () => Number(((await page.getByTestId("voucher-yield").textContent()) ?? "").replace(/[^0-9.]/g, "")), { timeout: 60_000 }).toBeGreaterThan(1);

    // Too expensive for the yield: priced, but payment is blocked and principal is not offered
    shop.nextPrice = 150;
    await page.getByTestId("brand-swiggy").click();
    await page.getByTestId("voucher-price").click();
    await expect(page.getByTestId("voucher-quote")).toBeVisible();
    await expect(page.getByTestId("quote-short")).toContainText("Only earned yield can be spent");
    await expect(page.getByTestId("voucher-pay")).toBeDisabled();
    await page.getByRole("button", { name: "Cancel" }).click();

    // A price above the safety ceiling is refused outright, even if the service sent it
    shop.nextPrice = 5000;
    await page.getByTestId("brand-swiggy").click();
    await page.getByTestId("voucher-price").click();
    await expect(page.getByTestId("voucher-failed")).toContainText("looks wrong");
    await page.getByRole("button", { name: "Back" }).click();

    // Affordable: price it, reject the wallet once (nothing leaves), then pay for real
    shop.nextPrice = 1.5;
    const invoiceBefore = await usdcOf(INVOICE_ADDR);
    await page.getByTestId("brand-swiggy").click();
    await page.getByTestId("pkg-1").click();
    await page.getByTestId("voucher-price").click();
    await expect(page.getByTestId("quote-price")).toHaveText("1.50 USDC");
    if (process.env.SHOT) await page.screenshot({ path: "/tmp/oy-voucher-quote.png" });
    await page.evaluate(() => ((window as unknown as { __rejectNext: boolean }).__rejectNext = true));
    await page.getByTestId("voucher-pay").click();
    await expect(page.getByTestId("voucher-tx-error")).toContainText("cancelled", { timeout: 30_000 });
    expect(await usdcOf(INVOICE_ADDR)).toBe(invoiceBefore);

    await page.getByTestId("voucher-pay").click();
    await expect(page.getByTestId("voucher-delivered")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("voucher-code")).toHaveText("SWIG-TEST-1234");
    await expect(page.getByTestId("voucher-pin")).toHaveText("4321");
    if (process.env.SHOT) await page.screenshot({ path: "/tmp/oy-voucher-done.png" });
    expect(shop.polls).toBeGreaterThanOrEqual(2); // it waited through a "processing" poll

    // On-chain truth: exactly 1.50 USDC reached the invoice address; the principal line did not move
    expect((await usdcOf(INVOICE_ADDR)) - invoiceBefore).toBe(1_500_000n);
    await page.getByTestId("tab-vault").click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00");
    await page.getByTestId("tab-vouchers").click();

    // Codes are not stored locally; history keeps only a reference and can re-fetch the code
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain("SWIG-TEST-1234");
    expect(stored).toContain("inv_e2e_3"); // the third invoice of this run (two earlier quotes were never paid)
    await page.getByTestId("voucher-done").click();
    await expect(page.getByTestId("voucher-history")).toContainText("Swiggy");
    await page.getByRole("button", { name: "Show code" }).click();
    await expect(page.getByTestId("voucher-code")).toHaveText("SWIG-TEST-1234");
    expect(errors).toEqual([]);
  });
});
