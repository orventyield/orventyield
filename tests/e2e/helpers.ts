import { expect, type Page } from "@playwright/test";

export const DEMO_CODE = "123456";

/** Choose a country in the glass dropdown (it replaced the native <select>). */
export async function pickCountry(page: Page, iso: string) {
  const trigger = page.getByTestId("phone-country");
  if ((await trigger.getAttribute("data-value")) === iso) return;
  await trigger.click();
  await page.getByTestId(`country-option-${iso}`).click();
  await expect(page.getByTestId("phone-country-panel")).toHaveCount(0);
}

const FORK_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK_RPC = "http://127.0.0.1:8545";

/** An EIP-6963 wallet whose RPC is the local Anvil fork (Arbitrum state), signing with Anvil's first key. */
export async function installForkWallet(page: Page) {
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
    { account: FORK_ACCOUNT, fork: FORK_RPC },
  );
}

/** Connect the fork wallet; the Mainnet dashboard opens on the Card step that asks for a verified phone. */
export async function connectForkWallet(page: Page) {
  await installForkWallet(page);
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.anvil.wallet").click();
  await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("card-verify-phone")).toBeVisible({ timeout: 30_000 });
}

/** Verify a phone number with the demo code from the Mainnet Card step, and wait for the next step (issuer sign-in). */
export async function activateCard(page: Page, opts: { country?: string; national?: string; code?: string } = {}) {
  const { country = "IN", national = "98765 43210", code = DEMO_CODE } = opts;
  await page.getByTestId("card-verify-phone").click();
  await pickCountry(page, country);
  await page.getByTestId("phone-input").fill(national);
  await page.getByTestId("phone-submit").click();
  await page.getByTestId("otp-input").fill(code);
  await expect(page.getByTestId("otp-dialog")).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByTestId("card-step-login")).toBeVisible();
}

/**
 * A minimal EIP-6963 wallet. It exposes accounts only after the user approves, and signs `personal_sign` through a
 * Node-side function so tests can use real keys. Pass `rpc` to forward everything else to a node (the Anvil fork).
 */
export async function installMockWallet(page: Page, account: string, sign: (message: string) => Promise<string>, chainHex = "0xa", rpc?: string) {
  await page.exposeFunction("__signMessage", async (hex: string) => {
    const bytes = hex.startsWith("0x") ? hex.slice(2) : hex;
    return sign(Buffer.from(bytes, "hex").toString("utf8"));
  });
  await page.addInitScript(
    ({ account, chainHex, rpc }) => {
      const info = {
        uuid: "00000000-0000-4000-8000-0000000000bb",
        name: "Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        rdns: "test.wallet",
      };
      let authorized = false;
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") {
            authorized = true;
            return [account];
          }
          if (method === "eth_accounts") return authorized ? [account] : [];
          if (method === "eth_chainId") return chainHex;
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "personal_sign") return (window as unknown as { __signMessage: (m: string) => Promise<string> }).__signMessage(String(params?.[0]));
          // With an RPC (the Anvil fork) every other call is forwarded, so the app can read chain state.
          if (rpc) {
            const j = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }) }).then((r) => r.json());
            if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
            return j.result;
          }
          throw Object.assign(new Error("unsupported by mock"), { code: 4200 });
        },
        on() {},
        removeListener() {},
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account, chainHex, rpc },
  );
}
