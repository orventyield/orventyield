import { expect, test, type Page } from "@playwright/test";
import { installForkWallet } from "./helpers";

/**
 * "Link your card" on Arbitrum One against the Anvil fork: the provider link, address validation, the $1 test, verification, and
 * adding money from yield and from principal, with the real on-chain effect checked at the card address. Run `npm run fork` first.
 */
const FORK = "http://127.0.0.1:8545";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const CARD = "0x00000000000000000000000000000000c0ffee01";
const pad = (a: string) => a.toLowerCase().replace("0x", "").padStart(64, "0");

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const usdcOf = async (a: string) => BigInt(await rpc<string>("eth_call", [{ to: USDC, data: `0x70a08231${pad(a)}` }, "latest"]));

async function connect(page: Page) {
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
}

test.describe("link your card (Arbitrum One, RedotPay)", () => {
  let snapshot: string;
  test.beforeAll(async () => {
    test.skip(((await rpc<string>("eth_chainId").catch(() => null)) as string | null) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
  });
  test.beforeEach(async () => {
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterEach(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("provider link, address checks, $1 test, verify, add from yield and from principal, survives a reload", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await connect(page);
    // This address already holds a little USDC on real Arbitrum (someone sent dust), so everything below is a DELTA from it.
    const base = await usdcOf(CARD);
    const got = async () => (await usdcOf(CARD)) - base;

    // Real position first: 1,000 USDC, then 30 days of yield
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");
    const safe = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();

    // The panel names the chain and token, and the provider link is a plain, safe external link
    const panel = page.getByTestId("linked-card-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("card-network-badge")).toHaveText("Arbitrum One · USDC");
    const link = page.getByTestId("card-provider-link");
    await expect(link).toHaveAttribute("href", "https://www.redotpay.com");
    await expect(link).toHaveAttribute("target", "_blank");
    expect(await link.getAttribute("rel")).toContain("noopener");
    await expect(page.getByTestId("card-caution")).toContainText("not affiliated");
    await expect(page.getByTestId("card-add-open")).toHaveCount(0); // nothing to add to yet

    // Address checks: every bad input is refused with a reason, and the button stays disabled
    await page.getByTestId("link-card-open").click();
    const input = page.getByTestId("card-address-input");
    const bad: [string, RegExp][] = [
      ["TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", /EVM address/],
      ["0x1234", /EVM address/],
      ["0x00000000000000000000000000000000c0ffee0", /EVM address/],
      ["0xAF88d065e77c8cC2239327C5EDb3A432268e5831", /typo/], // USDC with one capital letter changed
      [USDC, /token or protocol/],
      [safe, /own wallet or Safe/],
      ["0x0000000000000000000000000000000000000000", /real deposit address/],
    ];
    for (const [value, why] of bad) {
      await input.fill(value);
      await expect(page.getByTestId("card-address-error"), value).toContainText(why);
      await expect(page.getByTestId("card-link-confirm")).toBeDisabled();
    }
    // A good address still needs the explicit "I copied this from the app" confirmation
    await input.fill(CARD);
    await expect(page.getByTestId("card-address-ok")).toBeVisible();
    await expect(page.getByTestId("card-link-confirm")).toBeDisabled();
    await page.getByTestId("card-address-ack").check();
    await page.getByTestId("card-link-confirm").click();
    await expect(page.getByTestId("card-status")).toContainText("Step 2 of 3");
    await expect(page.getByTestId("linked-address")).toHaveText(/0x00000000000000000000000000000000[cC]0[fF][fF][eE][eE]01/);
    await expect(page.getByTestId("card-add-open")).toHaveCount(0); // adding more is locked until the test is confirmed

    // $1.00 test from yield: exactly 1.000000 USDC reaches the card address (a double click still sends once)
    // (the dashboard re-reads the position every 30s, so wait until it has seen the 30 days of yield)
    await expect.poll(async () => Number(((await page.getByTestId("card-yield-max").textContent()) ?? "0").replace(/[^0-9.]/g, "")), { timeout: 90_000 }).toBeGreaterThan(1.6);
    await page.getByTestId("card-test-open").click();
    await expect(page.getByTestId("card-source-yield")).toBeChecked();
    await expect(page.getByTestId("card-destination")).toContainText("Arbitrum One · USDC");
    await page.getByTestId("card-test-send").dblclick();
    await expect(page.getByTestId("card-test-sent")).toBeVisible({ timeout: 120_000 });
    expect(await got()).toBe(1_000_000n);
    expect(await usdcOf(safe)).toBe(0n);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("card-status")).toContainText("Step 3 of 3");
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00"); // yield paid it; principal untouched
    await expect(page.getByTestId("card-add-open")).toHaveCount(0);

    // The user checks their card app, then confirms
    await page.getByTestId("card-test-confirm").click();
    await expect(page.getByTestId("card-status")).toHaveText("Verified");

    // Add money from YIELD: over the yield is refused, a small amount goes through
    await page.getByTestId("card-add-open").click();
    await expect(page.getByTestId("network-badge")).toHaveText("Arbitrum One · USDC");
    await expect(page.getByTestId("preset-100")).toBeDisabled(); // far more than ~$2 of yield
    await page.getByTestId("amount-input").fill("50");
    await expect(page.getByTestId("amount-over")).toBeVisible();
    await expect(page.getByTestId("amount-confirm")).toBeDisabled();
    await page.getByTestId("amount-input").fill("0.5");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    expect(await got()).toBe(1_500_000n);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00");

    // Add money from PRINCIPAL (explicit choice): exactly $10 leaves the position
    await page.getByTestId("card-add-open").click();
    await page.getByTestId("card-source-principal").check();
    await expect(page.getByTestId("tx-preview")).toContainText("deposited principal");
    await page.getByTestId("preset-10").click();
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 120_000 });
    expect(await got()).toBe(11_500_000n);
    expect(await usdcOf(safe)).toBe(0n);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$990.00", { timeout: 30_000 });

    // Remembered after a reload (this browser only), and removable
    await page.reload();
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("card-status")).toHaveText("Verified", { timeout: 30_000 });
    await expect(page.getByTestId("linked-address")).toBeVisible();
    await page.getByTestId("card-unlink").click();
    await expect(page.getByTestId("card-get")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a tampered saved card (wrong chain, own Safe, bad address) is ignored, never sent to", async ({ page }) => {
    await connect(page);
    const safe = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();
    const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const key = `oy.linkedcards.v1.${owner.toLowerCase()}`;
    const bad = [
      { provider: "solcard", network: "arbitrum", token: "USDC", address: CARD, status: "verified", linkedAt: 1 }, // provider on the wrong chain
      { provider: "redotpay", network: "arbitrum", token: "USDC", address: safe, status: "verified", linkedAt: 1 }, // the user's own Safe
      { provider: "redotpay", network: "arbitrum", token: "USDC", address: "0xnope", status: "verified", linkedAt: 1 },
    ];
    await page.evaluate(([k, v]) => window.localStorage.setItem(k!, v!), [key, JSON.stringify(bad)]);
    await page.reload();
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("card-get")).toBeVisible({ timeout: 30_000 }); // treated as "no card linked"
    await expect(page.getByTestId("card-add-open")).toHaveCount(0);
  });
});
