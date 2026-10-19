import { expect, test } from "@playwright/test";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";

async function forkChainId(): Promise<string | null> {
  try {
    const r = await fetch(FORK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return ((await r.json()) as { result: string }).result;
  } catch {
    return null;
  }
}

test("connects to the local Anvil fork and shows the wallet's real ETH and USDC", async ({ page }) => {
  test.skip((await forkChainId()) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Minimal EIP-6963 wallet that signs nothing and forwards reads to the fork.
  await page.addInitScript(
    ({ account, fork }) => {
      const info = {
        uuid: "00000000-0000-4000-8000-000000000001",
        name: "Anvil Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        rdns: "test.anvil.wallet",
      };
      const rpc = (method: string, params: unknown[]) =>
        fetch(fork, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          });
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return "0x7a69";
          if (method === "wallet_switchEthereumChain") return null;
          return rpc(method, params ?? []);
        },
        on() {},
        removeListener() {},
      };
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account: ACCOUNT, fork: FORK },
  );

  await page.goto("/dashboard");
  // wagmi may reconnect an announced wallet on its own; click Connect only if it is still offered.
  const connect = page.getByTestId("connect-wallet");
  if (await connect.isVisible({ timeout: 2000 }).catch(() => false)) await connect.click();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

  await expect(page.getByTestId("chain-select")).toHaveValue("31337");
  const badge = page.getByTestId("fork-wallet");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/10,000(\.\d+)? ETH/);
  await expect(badge).toContainText(/USDC/);
  const usdc = Number(((await badge.textContent()) ?? "").match(/([\d,]+(?:\.\d+)?)\s*USDC/)?.[1]?.replace(/,/g, ""));
  expect(usdc).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
