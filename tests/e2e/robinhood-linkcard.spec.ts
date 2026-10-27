import { expect, test, type Page } from "@playwright/test";
import { installForkWallet } from "./helpers";

/**
 * "Link your card" on Robinhood Chain (SolCard, USDG) against an Anvil FORK OF ROBINHOOD CHAIN on port 8545:
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 31337 --port 8545
 *   FORK_RH=1 npx playwright test --project=desktop robinhood-linkcard
 * USDG is funded on the fork only, by impersonating Morpho Blue (a real holder). Nothing touches a real network.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const VAULT = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";
const MORPHO_BLUE = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const CARD = "0x00000000000000000000000000000000c0ffee02";
const ETH_100 = "0x56BC75E2D63100000";
const pad = (a: string) => a.toLowerCase().replace("0x", "").padStart(64, "0");

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const usdgOf = async (a: string) => BigInt(await rpc<string>("eth_call", [{ to: USDG, data: `0x70a08231${pad(a)}` }, "latest"]));

async function fundUsdg(to: string, baseUnits: bigint) {
  await rpc("anvil_setBalance", [MORPHO_BLUE, ETH_100]);
  await rpc("anvil_impersonateAccount", [MORPHO_BLUE]);
  const hash = await rpc<string>("eth_sendTransaction", [{ from: MORPHO_BLUE, to: USDG, data: `0xa9059cbb${pad(to)}${baseUnits.toString(16).padStart(64, "0")}` }]);
  for (let i = 0; i < 50 && !(await rpc<unknown>("eth_getTransactionReceipt", [hash])); i++) await new Promise((r) => setTimeout(r, 200));
}

async function open(page: Page) {
  await page.route(/blue-api\.morpho\.org/, (route) =>
    route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ data: { vaultV2s: { items: [{ address: VAULT, netApy: 0.0384 }] } } }) }),
  );
  await page.route(/li\.quest|li\.fi|jumper\.exchange/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("network-switcher")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("network-option-robinhood").click();
  await expect(page.getByTestId("rh-dashboard")).toBeVisible({ timeout: 60_000 });
}

test.describe("link your card (Robinhood Chain, SolCard)", () => {
  let snapshot: string;
  test.beforeAll(async () => {
    test.skip(process.env.FORK_RH !== "1", "needs the Robinhood Chain fork on port 8545: see the header of this file");
    test.skip(((await rpc<string>("eth_getCode", [VAULT, "latest"]).catch(() => "0x")) as string) === "0x", "port 8545 is not a Robinhood Chain fork");
  });
  test.beforeEach(async () => {
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterEach(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("SolCard link, USDG-only address checks, $1 test, verify, add from yield and principal", async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await rpc("anvil_setBalance", [ACCOUNT, ETH_100]);
    await fundUsdg(ACCOUNT, 5_000_000_000n);
    const base = await usdgOf(CARD);
    const got = async () => (await usdgOf(CARD)) - base;
    await open(page);

    // Real Morpho position first: 5,000 USDG, then 30 days
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("5000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$5,000.00", { timeout: 30_000 });
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");
    const safe = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();

    // The panel is for THIS chain: SolCard, USDG, Robinhood Chain (not RedotPay / USDC)
    await expect(page.getByTestId("card-network-badge")).toHaveText("Robinhood Chain · USDG");
    const link = page.getByTestId("card-provider-link");
    await expect(link).toHaveAttribute("href", "https://www.solcard.cc");
    await expect(link).toHaveAttribute("target", "_blank");
    expect(await link.getAttribute("rel")).toContain("noopener");
    await expect(page.getByTestId("card-get")).not.toContainText("RedotPay");
    await expect(page.getByTestId("card-caution")).toContainText("confirm the network name");

    await page.getByTestId("link-card-open").click();
    const input = page.getByTestId("card-address-input");
    const bad: [string, RegExp][] = [
      [USDG, /token or protocol/],
      [VAULT, /token or protocol/],
      [MORPHO_BLUE, /token or protocol/],
      [safe, /own wallet or Safe/],
      ["TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", /EVM address/],
    ];
    for (const [value, why] of bad) {
      await input.fill(value);
      await expect(page.getByTestId("card-address-error"), value).toContainText(why);
      await expect(page.getByTestId("card-link-confirm")).toBeDisabled();
    }
    await input.fill(CARD);
    await page.getByTestId("card-address-ack").check();
    await page.getByTestId("card-link-confirm").click();
    await expect(page.getByTestId("card-status")).toContainText("Step 2 of 3");
    await expect(page.getByTestId("card-add-open")).toHaveCount(0);

    // $1.00 test of USDG from yield (double click: still one send)
    await expect.poll(async () => Number(((await page.getByTestId("card-yield-max").textContent()) ?? "0").replace(/[^0-9.]/g, "")), { timeout: 90_000 }).toBeGreaterThan(2);
    await page.getByTestId("card-test-open").click();
    await expect(page.getByTestId("card-destination")).toContainText("Robinhood Chain · USDG");
    await page.getByTestId("card-test-send").dblclick();
    await expect(page.getByTestId("card-test-sent")).toBeVisible({ timeout: 120_000 });
    expect(await got()).toBe(1_000_000n);
    expect(await usdgOf(safe)).toBe(0n);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$5,000.00"); // yield paid it
    await page.getByTestId("card-test-confirm").click();
    await expect(page.getByTestId("card-status")).toHaveText("Verified");

    // Add $0.50 from yield, then exactly $10 from principal
    await page.getByTestId("card-add-open").click();
    await expect(page.getByTestId("network-badge")).toHaveText("Robinhood Chain · USDG");
    await page.getByTestId("amount-input").fill("0.5");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    expect(await got()).toBe(1_500_000n);
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByTestId("card-add-open").click();
    await page.getByTestId("card-source-principal").check();
    await page.getByTestId("preset-10").click();
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    expect(await got()).toBe(11_500_000n);
    expect(await usdgOf(safe)).toBe(0n);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$4,990.00", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("fits a phone (360px): nothing in the card section sticks out, long address wraps, 44px+ actions", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page);
    // Nothing INSIDE the card section may stick out past the screen (the page header is a separate component with its own checks).
    const stickingOut = () =>
      page.getByTestId("linked-card-panel").evaluate((el) => {
        const vw = window.innerWidth;
        return [el, ...Array.from(el.querySelectorAll("*"))].filter((n) => { const r = (n as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; }).length;
      });
    const panel = page.getByTestId("linked-card-panel");
    await panel.scrollIntoViewIfNeeded();
    expect(await stickingOut()).toBe(0);
    for (const id of ["card-provider-link", "link-card-open"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await panel.screenshot({ path: testInfo.outputPath("linkcard-get.png") });

    await page.getByTestId("link-card-open").click();
    await page.getByTestId("card-address-input").fill(CARD);
    await page.getByTestId("card-address-ack").check();
    const dlg = (await page.getByRole("dialog").boundingBox())!;
    expect(dlg.x).toBeGreaterThanOrEqual(0);
    expect(dlg.x + dlg.width).toBeLessThanOrEqual(361);
    await page.screenshot({ path: testInfo.outputPath("linkcard-dialog.png") });
    await page.getByTestId("card-link-confirm").click();

    await expect(page.getByTestId("card-status")).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    const addr = await page.getByTestId("linked-address").boundingBox();
    expect(addr!.x + addr!.width).toBeLessThanOrEqual(361);
    for (const id of ["card-test-open", "card-replace", "card-unlink"]) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    expect(await stickingOut()).toBe(0);
    await panel.screenshot({ path: testInfo.outputPath("linkcard-linked.png") });

    // With no yield yet the test cannot start from yield, and the reason is shown: it never silently falls back to principal
    await page.getByTestId("card-test-open").click();
    await expect(page.getByTestId("card-source-yield")).toBeChecked();
    await expect(page.getByTestId("card-test-send")).toBeDisabled();
    await expect(page.getByTestId("card-test-hint")).toContainText("earned");
  });
});
