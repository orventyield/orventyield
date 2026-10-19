import { expect, test, type Page } from "@playwright/test";
import { activateCard } from "./helpers";

const num = (s: string | null) => Number((s ?? "").replace(/[^0-9.\-]/g, ""));
const text = async (page: Page, id: string) => (await page.getByTestId(id).first().textContent()) ?? "";
const money = async (page: Page, id: string) => num((await text(page, id)).replace(/,/g, ""));

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

async function deposit(page: Page, asset: string, amount: string) {
  await page.getByTestId("asset-select").selectOption(asset);
  await page.getByTestId("open-deposit").click();
  await page.getByTestId("deposit-input").fill(amount);
  await page.getByTestId("deposit-confirm").click();
}

async function withdraw(page: Page, asset: string, amount: string) {
  await page.getByTestId("asset-select").selectOption(asset);
  await page.getByTestId("open-withdraw").click();
  await page.getByTestId("withdraw-input").fill(amount);
  await page.getByTestId("withdraw-confirm").click();
}

test.describe("playground dashboard", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    const res = await page.goto("/dashboard");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("mode-toggle")).toBeVisible();
  });

  test.afterEach(() => {
    expect(errors, "no console errors or page errors").toEqual([]);
  });

  test("starts in Playground with a Playground/Mainnet toggle and no warning banners", async ({ page }) => {
    await expect(page.getByTestId("mode-playground")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("mode-mainnet")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("sandbox-banner")).toHaveCount(0);
    await expect(page.getByText("Nothing here moves real funds")).toHaveCount(0);
    await expect(page.getByText("Ether.fi Verified")).toHaveCount(0);
    await expect(page.getByTestId("connect-wallet")).toBeEnabled();
  });

  test("the card is locked until the mobile number is verified, and a swipe is declined", async ({ page }) => {
    await expect(page.getByTestId("card-locked")).toBeVisible();
    await expect(page.getByTestId("card-status")).toHaveText("NOT ACTIVATED");
    await expect(page.getByTestId("freeze-toggle")).toHaveCount(0);
    await expect(page.getByTestId("card-pan")).toHaveCount(0);
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: CARD NOT ACTIVATED");
  });

  test("virtual card: masked PAN toggle, valid Luhn PAN, expiry, CVV on flip", async ({ page }) => {
    await activateCard(page);
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

  test("POS: approve with receipt; post-spend health factor is liquidation-threshold based", async ({ page }) => {
    await activateCard(page);
    await page.getByTestId("preset-apple").click();
    const collateral = await money(page, "collateral-value");
    const yieldBefore = num(await text(page, "yield-value"));
    const buffer = num(await text(page, "micro-buffer"));
    const debtBefore = num(await text(page, "debt-value"));

    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");

    const credit = Math.max(0, 149 - yieldBefore - buffer);
    const expectedHf = (collateral * 0.75) / (debtBefore + credit); // weETH liquidation threshold 75%
    const shown = num(await text(page, "receipt-hf"));
    expect(Math.abs(shown - expectedHf)).toBeLessThan(0.02);

    await expect(page.getByTestId("receipt-auth")).toHaveText(/^\d{6}$/);
    await expect(page.getByTestId("receipt-hash")).toHaveText(/^0x[0-9a-f]{8}…[0-9a-f]{8}$/);
    await expect(page.getByTestId("receipt-source")).toHaveText("Playground engine");
    expect(num(await text(page, "pos-latency"))).toBeLessThan(300);
  });

  test("POS: frozen card declines every swipe with DECLINED: CARD FROZEN", async ({ page }) => {
    await activateCard(page);
    await page.getByTestId("freeze-toggle").click();
    await expect(page.getByTestId("card-status")).toHaveText("FROZEN");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: CARD FROZEN");
    await expect(page.getByTestId("pos-receipt")).toHaveCount(0);
    await page.getByTestId("freeze-toggle").click();
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
  });

  test("POS: monthly limit, borrow limit (LTV) and invalid amount", async ({ page }) => {
    await activateCard(page);
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Big Purchase");
    await page.getByTestId("custom-amount").fill("4000");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: MONTHLY LIMIT EXCEEDED");

    await page.locator("#monthly-limit").fill("5000");
    await expect(page.getByTestId("monthly-limit-value")).toHaveText("$5,000");
    await page.getByTestId("custom-amount").fill("4400"); // weETH borrows at 55% LTV: limit is ~$2,599
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: INSUFFICIENT LIMIT");

    await page.getByTestId("custom-amount").fill("-5");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: INVALID AMOUNT");
  });

  test("POS: the 1.20x health-factor floor binds for stable collateral (USDC: LTV 90%, liq 95%)", async ({ page }) => {
    await activateCard(page);
    await deposit(page, "USDC", "1000");
    await withdraw(page, "weETH", "2"); // 1,000 USDC left against $350 debt: HF cap is debt <= 791.67
    await expect(page.getByTestId("collateral-value")).toContainText("1,000.00");
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Laptop");
    await page.getByTestId("custom-amount").fill("500"); // credit ~451 -> debt ~801 > 791.67
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: HEALTH FACTOR BELOW 1.20X");
    await page.getByTestId("custom-amount").fill("400"); // credit ~351 -> debt ~701: allowed
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
  });

  test("monthly limit slider spans $200-$5,000", async ({ page }) => {
    await activateCard(page);
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
    await expect(page.getByText("Not redeemable").first()).toBeVisible();

    for (let i = 0; i < 3; i++) await page.getByTestId("voucher-redeem").click();
    await expect(page.getByTestId("voucher-error")).toContainText("Not enough accrued yield");

    await page.getByTestId("fund-credit").click();
    await page.getByTestId("voucher-redeem").click();
    await expect(page.getByTestId("voucher-error")).toHaveCount(0);
    await openTab(page, /Vault & Card/);
    expect(num(await text(page, "debt-value"))).toBeCloseTo(350 + 25, 0);
  });

  test("cashout: validates UPI/IBAN/ACH, needs opt-in for credit, playground payout", async ({ page }) => {
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
    await page.getByTestId("cashout-amount").fill("200");
    await page.getByTestId("cashout-dest").fill("name@oksbi");
    await page.getByTestId("cashout-submit").click();
    await expect(page.getByTestId("cashout-error")).toContainText("Allow credit advance");

    await page.getByTestId("allow-credit").check();
    await page.getByTestId("cashout-submit").click();
    await expect(page.getByTestId("cashout-success")).toContainText("Payout of");
    await expect(page.getByTestId("cashout-success")).toContainText("no real money moved");
  });

  test("Auto-Pilot sweeps yield into debt and improves health factor", async ({ page }) => {
    await page.getByTestId("speed-10000").click();
    await page.waitForTimeout(3000);
    const hfBefore = num(await text(page, "hf-value"));
    const debtBefore = num(await text(page, "debt-value"));
    await page.getByTestId("autopilot-repay").click();
    expect(num(await text(page, "debt-value"))).toBeLessThan(debtBefore);
    expect(num(await text(page, "hf-value"))).toBeGreaterThan(hfBefore);
    await openTab(page, /Ledger/);
    await expect(page.getByTestId("ledger-row").first()).toContainText("Auto-Pilot");
  });

  test("micro-buffer advance is collateral-free and repaid first from newly accrued yield", async ({ page }) => {
    await activateCard(page);
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Buffer test");
    const yieldNow = num(await text(page, "yield-value"));
    const buffer = num(await text(page, "micro-buffer"));
    await page.getByTestId("custom-amount").fill((yieldNow + buffer / 2).toFixed(2));
    const debtBefore = num(await text(page, "debt-value"));
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-receipt")).toContainText("Funded by advance");
    expect(num(await text(page, "debt-value"))).toBeCloseTo(debtBefore, 2);
  });

  test("withdraw: borrow limit blocks a risky withdrawal; asset switch does not reinterpret amounts", async ({ page }) => {
    await page.getByTestId("open-withdraw").click();
    await page.getByTestId("withdraw-input").fill("1.95"); // leaves 0.05 weETH against $350 debt
    await page.getByTestId("withdraw-confirm").click();
    await expect(page.getByTestId("modal-error")).toContainText(/borrow limit|1\.20x/);
    await page.getByRole("button", { name: "Cancel" }).click();

    const before = await money(page, "limit-value");
    await deposit(page, "USDC", "1000");
    const after = await money(page, "limit-value");
    expect(after - before).toBeCloseTo(900, 0); // 1000 USDC at 90% LTV, not "1000 weETH"
  });

  test("contract status lists the verified Ether.fi deployment topology", async ({ page }) => {
    await page.getByTestId("contract-status").locator("summary").click();
    const panel = page.getByTestId("contract-status");
    await expect(panel).toContainText("Optimism");
    await expect(panel).toContainText("Live Cash deployment");
    await expect(panel).toContainText("Top-up source chain");
    await expect(panel).toContainText("CashModule");
    await expect(panel).toContainText("0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0");
    await expect(panel).toContainText("verified");
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
