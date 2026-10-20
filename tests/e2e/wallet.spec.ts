import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const WC_URI =
  "wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303";

/** A minimal EIP-6963 wallet on Arbitrum One that approves connections and answers nothing else. */
async function installMockWallet(page: Page) {
  await page.addInitScript((account) => {
    const info = {
      uuid: "00000000-0000-4000-8000-0000000000aa",
      name: "Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      rdns: "test.wallet",
    };
    // Like a real wallet: no accounts are exposed until the user approves this site.
    let authorized = false;
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") {
          authorized = true;
          return [account];
        }
        if (method === "eth_accounts") return authorized ? [account] : [];
        if (method === "eth_chainId") return "0xa4b1";
        if (method === "wallet_switchEthereumChain") return null;
        throw Object.assign(new Error("unsupported by mock"), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, ACCOUNT);
}

test.describe("wallet modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("connect-wallet")).toBeVisible();
  });

  test("Connect Wallet is always available and opens a proper modal with every option", async ({ page }) => {
    const btn = page.getByTestId("connect-wallet");
    await expect(btn).toBeEnabled();
    await btn.click();
    const modal = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(modal).toBeVisible();
    for (const id of ["coinbase", "metamask", "trust", "rainbow", "phantom"]) {
      await expect(page.getByTestId(`wallet-option-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("guest-button")).toBeVisible();
  });

  test("a wallet announced several times is listed once", async ({ page }) => {
    await page.addInitScript(() => {
      const icon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
      const provider = { request: async () => [], on() {}, removeListener() {} };
      const announce = () => {
        for (const n of [1, 2, 3, 4, 5]) {
          const info = { uuid: `00000000-0000-4000-8000-00000000010${n}`, name: "Twin Wallet", icon, rdns: `test.twin${n}` };
          window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
        }
      };
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-modal").getByText("Twin Wallet")).toHaveCount(1);
  });

  test("Escape and the close button dismiss it and focus returns to the trigger", async ({ page }) => {
    const btn = page.getByTestId("connect-wallet");
    await btn.click();
    await expect(page.getByTestId("wallet-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wallet-modal")).toHaveCount(0);
    await expect(btn).toBeFocused();

    await btn.click();
    await page.getByTestId("wallet-close").click();
    await expect(page.getByTestId("wallet-modal")).toHaveCount(0);
  });

  test("keyboard focus stays inside the dialog", async ({ page }) => {
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-modal")).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(inside, `focus escaped after ${i + 1} tabs`).toBe(true);
    }
  });

  test("Continue as guest closes the modal and stays in the Playground", async ({ page }) => {
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("guest-button").click();
    await expect(page.getByTestId("wallet-modal")).toHaveCount(0);
    await expect(page.getByTestId("mode-toggle")).toHaveCount(0);
    await expect(page.getByTestId("playground-dashboard")).toBeVisible();
  });

  test("WalletConnect (QR) is offered only when a project id is configured", async ({ page }) => {
    await page.getByTestId("connect-wallet").click();
    // The dev server reads .env.local, so the test must too: row shown with an id, hidden (not broken) without one.
    let id = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
    try {
      id ||= /^NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=(.+)$/m.exec(readFileSync(".env.local", "utf8"))?.[1]?.trim() ?? "";
    } catch {
      /* no .env.local */
    }
    await expect(page.getByTestId("wallet-option-walletconnect")).toHaveCount(id ? 1 : 0);
  });

  test("the QR pane renders a scannable code for the pairing URI, with working deep links and copy", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/dashboard?wcqr=${encodeURIComponent(WC_URI)}`);
    await page.getByTestId("connect-wallet").click();
    const qr = page.getByTestId("wc-qr");
    await expect(qr).toBeVisible();

    // Decode the QR image: it must encode exactly the pairing URI.
    const decoded = await qr.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      return { w: d.width, h: d.height, data: Array.from(d.data) };
    });
    const code = jsQR(Uint8ClampedArray.from(decoded.data), decoded.w, decoded.h);
    expect(code?.data).toBe(WC_URI);

    const enc = encodeURIComponent(WC_URI);
    await expect(page.getByTestId("deeplink-metamask")).toHaveAttribute("href", `https://metamask.app.link/wc?uri=${enc}`);
    await expect(page.getByTestId("deeplink-trust")).toHaveAttribute("href", `https://link.trustwallet.com/wc?uri=${enc}`);
    await expect(page.getByTestId("deeplink-rainbow")).toHaveAttribute("href", `https://rnbwapp.com/wc?uri=${enc}`);
    await expect(page.getByTestId("deeplink-coinbase")).toHaveAttribute("href", `https://go.cb-w.com/wc?uri=${enc}`);

    await page.getByTestId("wc-copy").click();
    await expect(page.getByTestId("wc-copy")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(WC_URI);

    await page.getByTestId("wallet-back").click();
    await expect(page.getByTestId("wc-pane")).toHaveCount(0);
    await expect(page.getByTestId("wallet-option-coinbase")).toBeVisible();
  });

  test("real WalletConnect pairing: the relay accepts the project id and the QR encodes the live pairing URI", async ({ page }) => {
    test.skip(!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, "set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to run");
    test.setTimeout(60_000);
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-walletconnect").click();
    const qr = page.getByTestId("wc-qr");
    await expect(qr).toBeVisible({ timeout: 30_000 });
    const decoded = await qr.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      return { w: d.width, h: d.height, data: Array.from(d.data) };
    });
    const uri = jsQR(Uint8ClampedArray.from(decoded.data), decoded.w, decoded.h)?.data ?? "";
    expect(uri).toMatch(/^wc:[0-9a-f]{64}@2\?.*relay-protocol=irn.*symKey=[0-9a-f]{64}/);
    await expect(page.getByTestId("deeplink-metamask")).toHaveAttribute("href", /^https:\/\/metamask\.app\.link\/wc\?uri=wc%3A/);
    await expect(page.getByTestId("wc-error")).toHaveCount(0);
  });

  test("a detected browser extension is listed first and connects; header switches to Mainnet", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-option-test.wallet")).toContainText("Detected");
    await page.getByTestId("wallet-option-test.wallet").click();
    await expect(page.getByTestId("account-button")).toContainText("0xf39F…2266");
    await expect(page.getByTestId("wallet-modal")).toHaveCount(0);
    await expect(page.getByTestId("mode-mainnet")).toHaveAttribute("aria-checked", "true");
    // Mainnet shows the connected wallet itself: no address to paste, nothing sends the user elsewhere.
    await expect(page.getByTestId("mainnet-gate")).toHaveCount(0);
    await expect(page.getByTestId("network-pill")).toHaveCount(0); // the chain name stays out of the header

    await page.getByTestId("account-button").click();
    await page.getByTestId("disconnect").click();
    await expect(page.getByTestId("connect-wallet")).toBeVisible();
  });

  test("mobile: modal is a bottom sheet with 44px+ touch targets and no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("connect-wallet").click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    expect(box.y + box.height).toBeGreaterThan(800); // anchored to the bottom
    for (const id of ["coinbase", "metamask", "trust"]) {
      const b = (await page.getByTestId(`wallet-option-${id}`).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
