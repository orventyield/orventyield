import { expect, test } from "@playwright/test";
import { installForkWallet } from "./helpers";

/**
 * Bridge & Deposit on the Anvil fork. A cross-chain bridge cannot run on a fork, so the LI.FI network is stubbed out and
 * the bridge's result is simulated the only way it is observable on chain: USDC arriving at the user's Safe address. What
 * is under test is everything we own: the entry point, the idle-USDC detection, and the one-click Safe -> Aave supply.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

test.describe("mainnet bridge & deposit", () => {
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

  test("bridged USDC that lands in the Safe is detected and supplied to Aave in one Safe transaction", async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    // No real LI.FI traffic in tests.
    await page.route(/li\.quest|li\.fi|jumper\.exchange/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("safe-status")).toHaveText("Created on first deposit");
    const safe = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();

    // The "bridge" delivers 5 USDC to the (not yet deployed) Safe address.
    const data = `0xa9059cbb${safe.toLowerCase().replace("0x", "").padStart(64, "0")}${(5_000_000n).toString(16).padStart(64, "0")}`;
    await rpc("eth_sendTransaction", [{ from: ACCOUNT, to: USDC, data }]);

    await page.getByTestId("open-bridge").click();
    await expect(page.getByTestId("bridge-dialog")).toBeVisible();
    await expect(page.getByTestId("bridge-idle")).toContainText("5.00 USDC", { timeout: 30_000 });

    // The lazy widget mounts inside our dialog (not the "Loading bridge" placeholder) and takes the dark theme.
    await expect(page.getByTestId("bridge-dialog").getByText("Loading bridge...")).toHaveCount(0, { timeout: 30_000 });
    expect(await page.getByTestId("bridge-dialog").evaluate((el) => el.querySelectorAll("[class*='MuiBox'], [class*='MuiButton'], [class*='Mui']").length)).toBeGreaterThan(0);
    const bg = await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = (bg.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    expect(Math.max(r!, g!, b!)).toBeLessThan(60);
    await page.screenshot({ path: "test-results/bridge-dialog.png" });

    await page.getByTestId("bridge-supply").click();
    await expect(page.getByTestId("bridge-success")).toBeVisible({ timeout: 90_000 });
    for (const s of ["deploy", "supply-idle"]) await expect(page.getByTestId(`step-${s}`)).toHaveAttribute("data-status", "done");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$5.00", { timeout: 30_000 });
    await expect(page.getByTestId("safe-status")).toHaveText("Active");
    expect(pageErrors).toEqual([]);
  });
});
