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

/** Open the dialog from the locked card, verify a phone number with the demo code, and wait for the card to unlock. */
export async function activateCard(page: Page, opts: { country?: string; national?: string; code?: string } = {}) {
  const { country = "IN", national = "98765 43210", code = DEMO_CODE } = opts;
  await page.getByTestId("card-activate").click();
  await pickCountry(page, country);
  await page.getByTestId("phone-input").fill(national);
  await page.getByTestId("phone-submit").click();
  await page.getByTestId("otp-input").fill(code);
  await expect(page.getByTestId("activation-success")).toBeVisible();
  await expect(page.getByTestId("card-unlocked")).toBeVisible();
  await expect(page.getByTestId("otp-dialog")).toHaveCount(0, { timeout: 5000 });
}

/**
 * A minimal EIP-6963 wallet. It exposes accounts only after the user approves, and signs `personal_sign` through a
 * Node-side function so tests can use real keys.
 */
export async function installMockWallet(page: Page, account: string, sign: (message: string) => Promise<string>, chainHex = "0xa") {
  await page.exposeFunction("__signMessage", async (hex: string) => {
    const bytes = hex.startsWith("0x") ? hex.slice(2) : hex;
    return sign(Buffer.from(bytes, "hex").toString("utf8"));
  });
  await page.addInitScript(
    ({ account, chainHex }) => {
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
          throw Object.assign(new Error("unsupported by mock"), { code: 4200 });
        },
        on() {},
        removeListener() {},
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account, chainHex },
  );
}
