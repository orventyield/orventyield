import { expect, test, type Page } from "@playwright/test";

/**
 * The real Mainnet flow (Safe + Aave v3) against the local Anvil Arbitrum fork. Start it with `npm run fork`.
 * The fork's dev account is unlocked, so the injected wallet forwards eth_sendTransaction and real transactions run.
 * The fork is snapshotted before and reverted after, so reruns start clean.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const forkUp = async () => rpc<string>("eth_chainId").catch(() => null);

async function installForkWallet(page: Page) {
  await page.addInitScript(
    ({ account, fork }) => {
      const info = { uuid: "00000000-0000-4000-8000-0000000000f1", name: "Anvil Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.anvil.wallet" };
      const call = (method: string, params: unknown[]) =>
        fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) })
          .then((r) => r.json())
          .then((j) => {
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          });
      let authorized = false;
      const w = window as unknown as { __rejectNext?: boolean; __sent?: string[] };
      w.__sent = [];
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") {
            authorized = true;
            return [account];
          }
          if (method === "eth_accounts") return authorized ? [account] : [];
          if (method === "eth_chainId") return "0x7a69";
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_sendTransaction") {
            if (w.__rejectNext) {
              w.__rejectNext = false;
              throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            }
            const hash = await call(method, params ?? []);
            w.__sent!.push(hash);
            return hash;
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

const money = async (page: Page, id: string) => Number(((await page.getByTestId(id).textContent()) ?? "").replace(/[^0-9.]/g, ""));

test.describe("mainnet: Safe + Aave on the fork", () => {
  test.describe.configure({ mode: "serial" });
  let snapshot: string;

  test.beforeAll(async () => {
    test.skip((await forkUp()) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
    snapshot = await rpc<string>("evm_snapshot");
    // Warm the fork's cache of the upstream state the dashboard reads (USDC, Aave reserve, Safe factory). If the fork
    // is days old the public RPC prunes its state ("missing trie node"): restart it with `npm run fork:stop && npm run fork`.
    const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
    const pad = (a: string) => a.toLowerCase().replace("0x", "").padStart(64, "0");
    const calls: [string, string][] = [
      [usdc, `0x70a08231${pad(ACCOUNT)}`],
      [usdc, `0xdd62ed3e${pad(ACCOUNT)}${pad("0x794a61358D6845594F94dc1DB02A252b5b4814aD")}`],
      ["0x794a61358D6845594F94dc1DB02A252b5b4814aD", `0x35ea6a75${pad(usdc)}`],
      ["0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", "0x53e5d935"],
    ];
    for (const [to, data] of calls) await rpc("eth_call", [{ to, data }, "latest"]).catch(() => undefined);
  });
  test.afterAll(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("deposit creates the Safe, supplies to Aave, and the dashboard shows real principal and live yield", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();

    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("safe-status")).toHaveText("Created on first deposit");
    await expect(page.getByTestId("principal-value")).toHaveText("$0.00");
    await expect(page.getByTestId("safe-address")).toHaveText(/^0x[0-9a-fA-F]{40}$/);
    await expect(page.getByText("Ether.fi")).toHaveCount(0);

    // Spending is one tap from the overview
    await expect(page.getByTestId("spend-shortcuts")).toBeVisible();
    await page.getByTestId("spend-cashout").click();
    await expect(page.getByTestId("tab-cashout")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tab-vault").click();

    // Validation before anything is sent
    await page.getByTestId("open-deposit").click();
    await expect(page.getByTestId("amount-confirm")).toBeDisabled();
    await expect(page.getByTestId("network-badge")).toHaveText("Arbitrum One · Native USDC");
    await expect(page.getByTestId("tx-preview")).toContainText("Create your Safe");
    await expect(page.getByTestId("tx-preview")).toContainText("exactly the amount you entered");
    await page.getByTestId("amount-input").fill("1.0000001");
    await expect(page.getByTestId("amount-invalid")).toContainText("at most 6 decimals");
    await page.getByTestId("amount-input").fill("999999999");
    await expect(page.getByTestId("amount-over")).toBeVisible();
    await expect(page.getByTestId("amount-confirm")).toBeDisabled();

    // Deposit 1,000 USDC: three real transactions (deploy, exact approve, supply)
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
    for (const s of ["deploy", "approve", "supply"]) await expect(page.getByTestId(`step-${s}`)).toHaveAttribute("data-status", "done");
    expect(await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent.length)).toBe(3);
    await page.getByRole("button", { name: "Done" }).click();

    await expect(page.getByTestId("safe-status")).toHaveText("Active", { timeout: 30_000 });
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
    await expect(page.getByTestId("apy-value")).toContainText("% APY");
    expect(errors).toEqual([]);
  });

  test("yield accrues, only yield can be withdrawn, principal stays locked, and a rejected signature is handled", async ({ page }) => {
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 60_000 });

    // 30 days pass on the fork; the chain, not the UI, produces the yield
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");
    await page.reload();
    await page.getByTestId("connect-wallet").click(); // a reload forgets the wallet session, like a real extension prompt
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 60_000 });
    await expect.poll(() => money(page, "yield-value"), { timeout: 60_000 }).toBeGreaterThan(1);

    // Over-asking is blocked in the UI
    await page.getByTestId("open-yield").click();
    await page.getByTestId("amount-input").fill("500");
    await expect(page.getByTestId("amount-over")).toBeVisible();
    await expect(page.getByTestId("amount-confirm")).toBeDisabled();

    // A rejected wallet prompt sends nothing and says so plainly
    await page.getByTestId("amount-max").click();
    await page.evaluate(() => ((window as unknown as { __rejectNext: boolean }).__rejectNext = true));
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-error")).toContainText("cancelled", { timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent.length)).toBe(0);

    // Retry succeeds: yield leaves to the wallet, principal is untouched
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00");
    await expect.poll(() => money(page, "yield-value"), { timeout: 60_000 }).toBeLessThan(0.5);
  });
});
