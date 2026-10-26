import { expect, test, type Page } from "@playwright/test";
import { installForkWallet } from "./helpers";

/**
 * Responsive pass for the Robinhood Chain screens at phone widths (Chromium device emulation: iPhone SE/8, iPhone 14,
 * Pixel 7). Needs the Robinhood fork on port 8545 (see robinhood-journey.spec.ts) and FORK_RH=1. No real device is used.
 */
const FORK = "http://127.0.0.1:8545";
const VAULT = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";
const SHOTS = "/private/tmp/claude-501/-Users-prasad-Projects-OrventYield/64a7d83f-a959-4386-8f50-42a52e0fb0eb/scratchpad/mobile";
const VIEWPORTS = [
  { name: "360", width: 360, height: 640 },
  { name: "375", width: 375, height: 667 },
  { name: "iphone14", width: 390, height: 844 },
  { name: "pixel7", width: 412, height: 915 },
];

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await r.json()) as { result: T }).result;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Every element's right edge stays inside the viewport (nothing is pushed off screen or clipped). */
const insideViewport = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, vw: window.innerWidth };
  });

test.describe("Robinhood Chain on phones", () => {
  test.beforeAll(async () => {
    test.skip(process.env.FORK_RH !== "1", "needs the Robinhood Chain fork on port 8545");
    test.skip(((await rpc<string>("eth_getCode", [VAULT, "latest"]).catch(() => "0x")) as string) === "0x", "port 8545 is not a Robinhood Chain fork");
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}px): header, vault tab, banner and dialog fit without side scroll`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/blue-api\.morpho\.org/, (route) =>
        route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ data: { vaultV2s: { items: [{ address: VAULT, netApy: 0.0384 }] } } }) }),
      );
      await installForkWallet(page);
      await page.goto("/dashboard");
      await page.getByTestId("connect-wallet").click();
      await page.getByTestId("wallet-option-test.anvil.wallet").click();
      await expect(page.getByTestId("network-switcher")).toBeVisible({ timeout: 30_000 });

      // Header: the switcher is on screen and the page does not scroll sideways
      let box = await insideViewport(page, "network-switcher");
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);

      // Its menu opens fully on screen, with 44px+ rows
      await page.getByTestId("network-switcher").click();
      for (const id of ["network-option-arbitrum", "network-option-robinhood"]) {
        const b = await page.getByTestId(id).evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height, vw: window.innerWidth }; });
        expect(b.l).toBeGreaterThanOrEqual(0);
        expect(b.r).toBeLessThanOrEqual(b.vw);
        expect(b.h).toBeGreaterThanOrEqual(44);
      }
      await page.getByTestId("network-option-robinhood").click();
      await expect(page.getByTestId("strategy-title")).toBeVisible({ timeout: 60_000 });

      // Vault tab: title, USDG badge and APY wrap inside the screen, nothing truncated sideways
      for (const id of ["strategy-title", "usdg-badge", "apy-value", "yield-value", "principal-value", "safe-address"]) {
        box = await insideViewport(page, id);
        expect(box.left, id).toBeGreaterThanOrEqual(0);
        expect(box.right, id).toBeLessThanOrEqual(box.vw);
      }
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/vault-${vp.name}.png`, fullPage: true });

      // Spending tabs: the banner text wraps and the 44px+ switch button is fully visible
      await page.getByTestId("tab-vouchers").click();
      await expect(page.getByTestId("spending-rails-banner")).toBeVisible();
      const clipped = await page.getByTestId("spending-rails-banner").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped).toBe(false);
      box = await insideViewport(page, "switch-to-arbitrum");
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      expect((await page.getByTestId("switch-to-arbitrum").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/spending-${vp.name}.png`, fullPage: true });

      // Deposit dialog is a bottom sheet that fits
      await page.getByTestId("tab-vault").click();
      await page.getByTestId("open-deposit").click();
      const dlg = (await page.getByRole("dialog").boundingBox())!;
      expect(dlg.x).toBeGreaterThanOrEqual(0);
      expect(dlg.x + dlg.width).toBeLessThanOrEqual(vp.width + 1);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/deposit-${vp.name}.png` });
      expect(errors).toEqual([]);
    });
  }
});
