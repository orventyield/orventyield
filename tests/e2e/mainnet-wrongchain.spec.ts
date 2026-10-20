import { expect, test } from "@playwright/test";

/**
 * A wallet connected on another supported network (Optimism here) is not blocked. The dashboard loads from public RPC reads
 * (served by the Anvil fork), shows a quiet notice, and the switch to Arbitrum happens only when the user does an Arbitrum
 * write. The wallet is a stand-in that really changes chain on wallet_switchEthereumChain and emits chainChanged.
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

test.describe("wallet on another network", () => {
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

  test("dashboard is not blocked; the switch to Arbitrum happens on the first Arbitrum write", async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    // Arbitrum public-RPC reads and receipts are served by the fork (same chain state).
    await page.route(/arb1\.arbitrum\.io/, async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" } });
      const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() ?? "{}" });
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: await r.text() });
    });
    await page.route(/li\.quest|li\.fi|jumper\.exchange/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.addInitScript(
      ({ account, fork }) => {
        const info = { uuid: "00000000-0000-4000-8000-0000000000f9", name: "Anvil Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.anvil.wallet" };
        const w = window as unknown as { __chain: string; __switches: number };
        w.__chain = "0xa"; // Optimism
        w.__switches = 0;
        const listeners: Record<string, ((v: unknown) => void)[]> = {};
        let authorized = false;
        const call = (method: string, params: unknown[]) =>
          fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) })
            .then((r) => r.json())
            .then((j) => {
              if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
              return j.result;
            });
        const provider = {
          request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            if (method === "eth_requestAccounts") {
              authorized = true;
              return [account];
            }
            if (method === "eth_accounts") return authorized ? [account] : [];
            if (method === "eth_chainId") return w.__chain;
            if (method === "wallet_switchEthereumChain") {
              w.__chain = (params?.[0] as { chainId: string }).chainId;
              w.__switches++;
              (listeners.chainChanged ?? []).forEach((f) => f(w.__chain));
              return null;
            }
            return call(method, params ?? []);
          },
          on(ev: string, f: (v: unknown) => void) {
            (listeners[ev] ??= []).push(f);
          },
          removeListener(ev: string, f: (v: unknown) => void) {
            listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f);
          },
        };
        const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
        window.addEventListener("eip6963:requestProvider", announce);
        announce();
      },
      { account: ACCOUNT, fork: FORK },
    );

    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();

    // Not blocked: the dashboard loads, with a quiet notice and a way to switch.
    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("wrong-network")).toHaveCount(0);
    await expect(page.getByTestId("network-notice")).toContainText("Everything here still loads");
    await expect(page.getByTestId("safe-address")).toHaveText(/^0x[0-9a-fA-F]{40}$/);
    expect(await page.evaluate(() => (window as unknown as { __switches: number }).__switches)).toBe(0);

    // Bridged USDC reaches the Safe; "Supply to Aave" is an Arbitrum write, so the switch happens now.
    const safe = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();
    const data = `0xa9059cbb${safe.toLowerCase().replace("0x", "").padStart(64, "0")}${(5_000_000n).toString(16).padStart(64, "0")}`;
    await rpc("eth_sendTransaction", [{ from: ACCOUNT, to: USDC, data }]);
    await page.getByTestId("open-bridge").click();
    await expect(page.getByTestId("bridge-idle")).toContainText("5.00 USDC", { timeout: 30_000 });
    await page.getByTestId("bridge-supply").click();
    await expect(page.getByTestId("bridge-success")).toBeVisible({ timeout: 90_000 });
    expect(await page.evaluate(() => (window as unknown as { __switches: number; __chain: string }).__chain)).toBe("0xa4b1");
    expect(await page.evaluate(() => (window as unknown as { __switches: number }).__switches)).toBe(1);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("network-notice")).toHaveCount(0);
    await expect(page.getByTestId("principal-value")).toHaveText("$5.00", { timeout: 30_000 });
    expect(pageErrors).toEqual([]);
  });
});
