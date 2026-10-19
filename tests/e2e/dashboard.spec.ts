import { expect, test, type Page } from "@playwright/test";

const num = (s: string | null) => Number((s ?? "").replace(/[^0-9.\-]/g, ""));
const text = async (page: Page, id: string) => (await page.getByTestId(id).first().textContent()) ?? "";

function luhn(pan: string) {
  let sum = 0;
  for (let i = pan.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let d = Number(pan[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

async function openTab(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).click();
}

test.describe("dashboard", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    const res = await page.goto("/dashboard");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("sandbox-banner")).toBeVisible();
  });

  test.afterEach(() => {
    expect(errors, "no console errors or page errors").toEqual([]);
  });

  test("labels itself a sandbox and has no live-mode toggle", async ({ page }) => {
    await expect(page.getByTestId("sandbox-badge")).toHaveText("SANDBOX");
    await expect(page.getByRole("button", { name: "Mainnet" })).toHaveCount(0);
    await expect(page.getByText("Ether.fi Verified")).toHaveCount(0);
  });

  test("virtual card: masked PAN toggle, valid Luhn PAN, expiry, CVV on flip", async ({ page }) => {
    const pan = page.getByTestId("card-pan");
    await expect(pan).toHaveText(/^•••• •••• •••• \d{4}$/);
    await page.getByTestId("pan-toggle").click();
    const revealed = ((await pan.textContent()) ?? "").replace(/\s/g, "");
    expect(revealed).toMatch(/^\d{16}$/);
    expect(luhn(revealed)).toBe(true);
    await expect(page.getByTestId("card-expiry")).toHaveText(/VALID THRU \d{2}\/\d{2}/);
    await page.getByTestId("pan-toggle").click();
    await expect(pan).toHaveText(/^•••• •••• •••• \d{4}$/);

    await page.getByTestId("card-flip").click();
    await expect(page.getByTestId("card-cvv")).toHaveText(/^\d{3}$/);
    await expect(page.getByTestId("card-flip")).toHaveAttribute("aria-pressed", "true");
  });

  test("POS: approve with receipt, post-spend health factor is the real post-spend value", async ({ page }) => {
    await openTab(page, /POS Terminal/);
    await page.getByTestId("preset-apple").click();

    // Read the live inputs right before the swipe.
    await openTab(page, /Vault & Card/);
    await page.getByTestId("preset-apple").click();
    const yieldBefore = num(await text(page, "yield-value"));
    const buffer = num(await text(page, "micro-buffer"));
    const debtBefore = num(await text(page, "debt-value"));

    const t0 = Date.now();
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
    expect(Date.now() - t0).toBeLessThan(300 * 10);

    const credit = Math.max(0, 149 - yieldBefore - buffer);
    const expectedHf = 5175 / (debtBefore + credit); // 2 weETH * $3,450 * 0.75 LTV
    const shown = num(await text(page, "receipt-hf"));
    expect(Math.abs(shown - expectedHf)).toBeLessThan(0.02);

    await expect(page.getByTestId("receipt-auth")).toHaveText(/^\d{6}$/);
    await expect(page.getByTestId("receipt-hash")).toHaveText(/^0x[0-9a-f]{8}…[0-9a-f]{8}$/);
    await expect(page.getByTestId("pos-receipt")).toContainText("Simulated");
    expect(num(await text(page, "pos-latency"))).toBeLessThan(300);
  });

  test("POS: frozen card declines every swipe with DECLINED: CARD FROZEN", async ({ page }) => {
    await page.getByTestId("freeze-toggle").click();
    await expect(page.getByTestId("card-status")).toHaveText("FROZEN");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: CARD FROZEN");
    await expect(page.getByTestId("pos-receipt")).toHaveCount(0);
    await page.getByTestId("freeze-toggle").click();
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
  });

  test("POS: enforces monthly limit and the 1.20x health-factor floor", async ({ page }) => {
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Big Purchase");
    await page.getByTestId("custom-amount").fill("4400"); // credit draw ~4,341 -> debt ~4,691 -> HF ~1.10x
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: MONTHLY LIMIT EXCEEDED");

    await page.locator("#monthly-limit").fill("5000");
    await expect(page.getByTestId("monthly-limit-value")).toHaveText("$5,000");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: HEALTH FACTOR BELOW 1.20X");

    await page.getByTestId("custom-amount").fill("-5");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: INVALID AMOUNT");
  });

  test("monthly limit slider spans $200-$5,000", async ({ page }) => {
    const slider = page.locator("#monthly-limit");
    await expect(slider).toHaveAttribute("min", "200");
    await expect(slider).toHaveAttribute("max", "5000");
    await slider.fill("200");
    await expect(page.getByTestId("monthly-limit-value")).toHaveText("$200");
  });

  test("vouchers: yield funding is free; credit funding borrows; codes match the format", async ({ page }) => {
    await openTab(page, /Voucher Store/);
    await page.getByTestId("fund-yield").click();
    await page.getByTestId("voucher-redeem").click();
    const code = await text(page, "voucher-code");
    expect(code).toMatch(/^AMZN-YLD-\d{4}-[A-Z2-9]{4}$/);
    await expect(page.getByText("not redeemable").first()).toBeVisible();

    // A second yield-funded purchase beyond the remaining yield must fail without borrowing.
    for (let i = 0; i < 3; i++) await page.getByTestId("voucher-redeem").click();
    await expect(page.getByTestId("voucher-error")).toContainText("Not enough accrued yield");

    await page.getByTestId("fund-credit").click();
    await page.getByTestId("voucher-redeem").click();
    await expect(page.getByTestId("voucher-error")).toHaveCount(0);
    await openTab(page, /Vault & Card/);
    expect(num(await text(page, "debt-value"))).toBeCloseTo(350 + 25, 0);
  });

  test("cashout: validates UPI/IBAN/ACH, needs opt-in for credit, simulated payout", async ({ page }) => {
    await openTab(page, /1-Click Bank/);
    await page.getByTestId("cashout-amount").fill("30");

    await page.getByTestId("cashout-dest").fill("not-a-upi");
    await page.getByTestId("cashout-submit").click();
    await expect(page.locator('[data-testid="cashout-error"], #cashout-dest-err').first()).toBeVisible();

    await page.getByTestId("rail-sepa").click();
    await page.getByTestId("cashout-dest").fill("DE89 3704 0044 0532 0130 01");
    await page.getByTestId("cashout-submit").click();
    await expect(page.locator("#cashout-dest-err")).toHaveText("IBAN checksum is invalid");
    await expect(page.getByTestId("cashout-error")).toHaveCount(0);

    await page.getByTestId("rail-ach").click();
    await page.getByTestId("cashout-dest").fill("021000022 123456789");
    await page.getByTestId("cashout-submit").click();
    await expect(page.locator("#cashout-dest-err")).toContainText("Routing number is invalid");

    await page.getByTestId("rail-upi").click();
    await page.getByTestId("cashout-amount").fill("200"); // more than the ~$48 yield
    await page.getByTestId("cashout-dest").fill("name@oksbi");
    await page.getByTestId("cashout-submit").click();
    await expect(page.getByTestId("cashout-error")).toContainText("Allow credit advance");

    await page.getByTestId("allow-credit").check();
    await page.getByTestId("cashout-submit").click();
    await expect(page.getByTestId("cashout-success")).toContainText("Simulated payout");
    await expect(page.getByTestId("cashout-success")).toContainText("No real money moved");
  });

  test("Auto-Pilot sweeps yield into debt and improves health factor", async ({ page }) => {
    await page.getByTestId("speed-10000").click();
    await page.waitForTimeout(3000);
    const hfBefore = num(await text(page, "hf-value"));
    const debtBefore = num(await text(page, "debt-value"));
    await page.getByTestId("autopilot-repay").click();
    const debtAfter = num(await text(page, "debt-value"));
    expect(debtAfter).toBeLessThan(debtBefore);
    expect(num(await text(page, "hf-value"))).toBeGreaterThan(hfBefore);
    await openTab(page, /Ledger/);
    await expect(page.getByTestId("ledger-row").first()).toContainText("Auto-Pilot");
  });

  test("micro-buffer advance is repaid first from newly accrued yield", async ({ page }) => {
    // Drain settled yield with a swipe larger than yield but within yield + buffer.
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Buffer test");
    const yieldNow = num(await text(page, "yield-value"));
    const buffer = num(await text(page, "micro-buffer"));
    const amount = (yieldNow + buffer / 2).toFixed(2);
    await page.getByTestId("custom-amount").fill(amount);
    const debtBefore = num(await text(page, "debt-value"));
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-receipt")).toContainText("Funded by advance");
    // Advance is collateral-free: credit-line debt must not change.
    expect(num(await text(page, "debt-value"))).toBeCloseTo(debtBefore, 2);
  });

  test("withdraw: HF floor blocks a risky withdrawal; asset switch does not reinterpret amounts", async ({ page }) => {
    await page.getByTestId("open-withdraw").click();
    await page.getByTestId("withdraw-input").fill("1.95"); // leaves 0.05 weETH against $350 debt
    await page.getByTestId("withdraw-confirm").click();
    await expect(page.getByTestId("modal-error")).toContainText("1.20x");
    await page.getByRole("button", { name: "Cancel" }).click();

    const before = num(await text(page, "limit-value").then((t) => t.replace(/,/g, "")));
    await page.getByTestId("asset-select").selectOption("USDC");
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("deposit-input").fill("1000");
    await page.getByTestId("deposit-confirm").click();
    const after = num(await text(page, "limit-value").then((t) => t.replace(/,/g, "")));
    expect(after - before).toBeCloseTo(850, 0); // 1000 USDC at 85% LTV, not "1000 weETH"
  });

  test("contract status is honest about unverified addresses", async ({ page }) => {
    await page.getByTestId("contract-status").locator("summary").click();
    await expect(page.getByTestId("contract-status")).toContainText("CashModule");
    await expect(page.getByTestId("contract-status")).toContainText("no-code");
    await expect(page.getByTestId("contract-status")).toContainText("verified");
  });

  test("mobile layout has no horizontal scroll on any tab", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of [/Vault & Card/, /POS Terminal/, /Voucher Store/, /1-Click Bank/, /Ledger/]) {
      await openTab(page, tab);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${tab}`).toBeLessThanOrEqual(0);
    }
  });
});
