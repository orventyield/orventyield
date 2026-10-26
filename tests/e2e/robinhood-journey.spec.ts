import { expect, test, type Page } from "@playwright/test";
import { installForkWallet } from "./helpers";

/**
 * The Robinhood Chain (Morpho) journey in a real browser against an Anvil FORK OF ROBINHOOD CHAIN on port 8545:
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 31337 --port 8545
 *   FORK_RH=1 npx playwright test --project=desktop robinhood-journey
 * (the Arbitrum fork specs need the Arbitrum fork on the same port, so they are not run in the same session). Nothing touches a
 * real network: USDG is moved on the fork by impersonating Morpho Blue, which holds it, and Morpho's APY API is stubbed.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const VAULT = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const MORPHO_BLUE = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const pad = (a: string) => a.toLowerCase().replace("0x", "").padStart(64, "0");

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const usdgOf = async (a: string) => BigInt(await rpc<string>("eth_call", [{ to: USDG, data: `0x70a08231${pad(a)}` }, "latest"]));
const ETH_100 = "0x56BC75E2D63100000";

async function fundUsdg(to: string, baseUnits: bigint) {
  await rpc("anvil_setBalance", [MORPHO_BLUE, ETH_100]);
  await rpc("anvil_impersonateAccount", [MORPHO_BLUE]);
  const hash = await rpc<string>("eth_sendTransaction", [{ from: MORPHO_BLUE, to: USDG, data: `0xa9059cbb${pad(to)}${baseUnits.toString(16).padStart(64, "0")}` }]);
  for (let i = 0; i < 50 && !(await rpc<unknown>("eth_getTransactionReceipt", [hash])); i++) await new Promise((r) => setTimeout(r, 200));
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Deterministic APY, no internet; and no real LI.FI traffic.
  await page.route(/blue-api\.morpho\.org/, (route) =>
    route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ data: { vaultV2s: { items: [{ address: VAULT, netApy: 0.0384 }] } } }) }),
  );
  await page.route(/li\.quest|li\.fi|jumper\.exchange/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("network-switcher")).toBeVisible({ timeout: 30_000 });
  return errors;
}
async function switchToRobinhood(page: Page) {
  await page.getByTestId("network-switcher").click();
  await page.getByTestId("network-option-robinhood").click();
  await expect(page.getByTestId("strategy-title")).toHaveText("Steakhouse USDG (Morpho Protocol)", { timeout: 60_000 });
}
const num = async (page: Page, id: string) => Number(((await page.getByTestId(id).textContent()) ?? "").replace(/[^0-9.]/g, ""));

test.describe("Robinhood Chain: Safe + Morpho Steakhouse USDG", () => {
  let snapshot: string;
  test.beforeAll(async () => {
    test.skip(process.env.FORK_RH !== "1", "needs the Robinhood Chain fork: see the header of this file");
    const code = await rpc<string>("eth_getCode", [VAULT, "latest"]).catch(() => "0x");
    test.skip(code === "0x", "port 8545 is not a Robinhood Chain fork");
  });
  test.beforeEach(async () => {
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterEach(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("no ETH for gas: an upfront warning, and every action is disabled before the user clicks", async ({ page }) => {
    await rpc("anvil_setBalance", [ACCOUNT, "0x0"]);
    await fundUsdg(ACCOUNT, 100_000_000n);
    const errors = await open(page);
    await switchToRobinhood(page);
    await expect(page.getByTestId("no-gas")).toContainText("Insufficient ETH for gas on Robinhood Chain");
    await expect(page.getByTestId("open-deposit")).toBeDisabled();
    await expect(page.getByTestId("wallet-usdg")).toHaveText("100.00");
    expect(errors).toEqual([]);
  });

  test("journey: connect, switch to Robinhood Chain, deposit with MAX, accrue yield, withdraw yield and principal", async ({ page }) => {
    test.setTimeout(240_000);
    await rpc("anvil_setBalance", [ACCOUNT, ETH_100]);
    const dust = 5_000_123_457n; // 5,000.123457 USDG: MAX must carry all six decimals
    await fundUsdg(ACCOUNT, dust);
    const funded = await usdgOf(ACCOUNT); // the wallet's whole USDG balance on the fork
    expect(funded).toBeGreaterThanOrEqual(dust);
    const errors = await open(page);

    // Switch network, with everything labelled USDG and the strategy named
    await switchToRobinhood(page);
    await expect(page.getByTestId("usdg-badge")).toContainText("USDG");
    await expect(page.getByTestId("apy-value")).toHaveText("+3.84% APY", { timeout: 30_000 });
    await expect(page.getByTestId("no-gas")).toHaveCount(0);
    await expect(page.getByTestId("safe-status")).toHaveText("Created on first deposit");
    await expect(page.getByTestId("wallet-usdg")).toHaveText("5,000.12", { timeout: 30_000 });

    // Deposit: MAX is exactly the wallet balance, to the last base unit
    await page.getByTestId("open-deposit").click();
    await expect(page.getByTestId("network-badge")).toHaveText("Robinhood Chain · USDG");
    await page.getByTestId("amount-max").click();
    const typed = await page.getByTestId("amount-input").inputValue();
    expect(BigInt(Math.round(Number(typed) * 1e6))).toBe(funded); // all six decimals
    expect(typed).toMatch(/^\d+\.\d{6}$/);
    await page.getByTestId("amount-confirm").dblclick(); // a double click still sends one set of transactions
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    for (const s of ["deploy", "approve", "deposit"]) await expect(page.getByTestId(`step-${s}`)).toHaveAttribute("data-status", "done");
    await page.getByRole("button", { name: "Done" }).click();
    expect(await usdgOf(ACCOUNT)).toBe(0n); // everything went in, nothing stranded, no revert
    await expect(page.getByTestId("safe-status")).toHaveText("Active", { timeout: 30_000 });
    await expect(page.getByTestId("principal-value")).toHaveText("5,000.12", { timeout: 30_000 });

    // 30 days of yield
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");
    await expect.poll(() => num(page, "yield-value"), { timeout: 90_000 }).toBeGreaterThan(5);

    // Withdraw yield (MAX): the wallet receives exactly the typed amount
    const w0 = await usdgOf(ACCOUNT);
    await page.getByTestId("open-yield").click();
    await page.getByTestId("amount-max").click();
    const y = await page.getByTestId("amount-input").inputValue();
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Done" }).click();
    const w1 = await usdgOf(ACCOUNT);
    expect(w1 - w0).toBe(BigInt(Math.round(Number(y) * 1e6)));
    await expect(page.getByTestId("principal-value")).toHaveText("5,000.12"); // yield spend never touched principal

    // Withdraw principal (MAX)
    await page.getByTestId("open-principal").click();
    await page.getByTestId("amount-max").click();
    const p = await page.getByTestId("amount-input").inputValue();
    expect(BigInt(Math.round(Number(p) * 1e6))).toBe(dust);
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Done" }).click();
    expect((await usdgOf(ACCOUNT)) - w1).toBe(dust);
    await expect(page.getByTestId("principal-value")).toHaveText("0.00", { timeout: 30_000 });

    // Spending tabs: a clear, non-blocking note and a one-click way back to Arbitrum One
    for (const t of ["tab-vouchers", "tab-card", "tab-cashout"]) {
      await page.getByTestId(t).click();
      await expect(page.getByTestId("spending-rails-banner")).toContainText("Spending rails (Vouchers, Card, Bank) operate on Arbitrum One (USDC). Switch network to access spending.");
    }
    await page.getByTestId("switch-to-arbitrum").click();
    await expect(page.getByTestId("network-switcher")).toContainText("Arbitrum One");
    expect(errors).toEqual([]);
  });

  test("wallet rejection returns to a usable state; a hold-then-disconnect and a chain switch mid-flow raise no errors", async ({ page }) => {
    test.setTimeout(180_000);
    await rpc("anvil_setBalance", [ACCOUNT, ETH_100]);
    await fundUsdg(ACCOUNT, 200_000_000n);
    const errors = await open(page);
    await switchToRobinhood(page);
    const safe = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();

    // 1. Reject in the wallet: the dialog shows a calm message, nothing is stuck, and a retry works
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("50");
    await page.evaluate(() => ((window as unknown as { __rejectSend: boolean }).__rejectSend = true));
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-error")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("amount-confirm")).toBeEnabled();

    // 2. The wallet prompt is open (not decided yet) and the user changes network INSIDE the wallet: no crash, no wrong-chain surprise
    await page.evaluate(() => ((window as unknown as { __holdSend: boolean }).__holdSend = true));
    await page.getByTestId("amount-confirm").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __holding?: number }).__holding ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.keyboard.press("Escape"); // dismissing is blocked while a transaction is in flight
    await expect(page.getByTestId("deposit-dialog")).toBeVisible();
    await page.evaluate(() => (window as unknown as { __emitChain: (h: string) => void }).__emitChain("0xa4b1")); // wallet -> Arbitrum One
    await page.evaluate(() => (window as unknown as { __releaseSend: () => void }).__releaseSend());
    // Whatever the wallet was asked to sign went only to the Safe factory, USDG, the allowlisted vault or the user's own Safe
    await page.waitForTimeout(2000);
    const sent = await page.evaluate(() => (window as unknown as { __sent: { to: string }[] }).__sent.map((t) => t.to.toLowerCase()));
    expect(sent.length).toBeGreaterThan(0);
    const allowed = new Set([FACTORY.toLowerCase(), USDG.toLowerCase(), VAULT.toLowerCase(), safe.toLowerCase()]);
    for (const to of sent) expect(allowed.has(to)).toBe(true);
    // The app now shows a quiet notice instead of failing, and recovers when the wallet comes back
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("network-notice")).toContainText("Connected on", { timeout: 30_000 });
    await page.evaluate(() => (window as unknown as { __emitChain: (h: string) => void }).__emitChain("0x7a69"));
    await expect(page.getByTestId("network-notice")).toHaveCount(0, { timeout: 30_000 });

    // 3. A fresh, consistent screen afterwards (not stuck "Working…")
    await page.getByTestId("open-deposit").click();
    await expect(page.getByTestId("amount-confirm")).not.toHaveText("Working…");

    // 4. The wallet disconnects while a transaction prompt is open: the app returns to the connect screen, no unhandled error
    await page.getByTestId("amount-input").fill("25");
    await page.evaluate(() => ((window as unknown as { __holdSend: boolean }).__holdSend = true));
    await page.getByTestId("amount-confirm").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __holding?: number }).__holding ?? 0), { timeout: 60_000 }).toBeGreaterThan(1);
    await page.evaluate(() => (window as unknown as { __emitAccounts: (l: string[]) => void }).__emitAccounts([]));
    await expect(page.getByTestId("connect-wallet")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("deposit-dialog")).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __releaseSend: () => void }).__releaseSend());
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });
});
