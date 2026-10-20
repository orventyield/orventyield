import { expect, test, type Page } from "@playwright/test";

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

async function deposit(page: Page, amount: string) {
  await page.getByTestId("open-deposit").click();
  await page.getByTestId("deposit-input").fill(amount);
  await page.getByTestId("deposit-confirm").click();
}

async function withdraw(page: Page, amount: string) {
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
    await expect(page.getByTestId("playground-dashboard")).toBeVisible();
  });

  test.afterEach(() => {
    expect(errors, "no console errors or page errors").toEqual([]);
  });

  test("starts in Playground with no mode toggle while disconnected, and no warning banners", async ({ page }) => {
    await expect(page.getByTestId("mode-toggle")).toHaveCount(0); // the choice lives in one place, not three
    await expect(page.getByTestId("playground-dashboard")).toBeVisible();
    await expect(page.getByTestId("sandbox-banner")).toHaveCount(0);
    await expect(page.getByText("Nothing here moves real funds")).toHaveCount(0);
    await expect(page.getByTestId("connect-wallet")).toBeEnabled();
  });

  test("the demo card is active from the first visit: no phone or KYC, a swipe is approved", async ({ page }) => {
    await expect(page.getByTestId("card-unlocked")).toBeVisible();
    await expect(page.getByTestId("card-status")).toHaveText("ACTIVE");
    await expect(page.getByTestId("card-activate")).toHaveCount(0);
    await expect(page.getByTestId("otp-dialog")).toHaveCount(0);
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
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

  test("POS: a swipe is paid from earned yield only; principal never moves", async ({ page }) => {
    await page.getByTestId("preset-starbucks").click();
    const principal = await text(page, "principal-value");
    const yieldBefore = await money(page, "yield-value");

    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
    await expect(page.getByTestId("receipt-funding")).toHaveText("$4.85");
    await expect(page.getByTestId("receipt-hf")).toHaveCount(0); // there is no health factor: nothing is borrowed
    await expect(page.getByTestId("receipt-auth")).toHaveText(/^\d{6}$/);
    await expect(page.getByTestId("receipt-hash")).toHaveText(/^0x[0-9a-f]{8}…[0-9a-f]{8}$/);
    await expect(page.getByTestId("receipt-source")).toHaveText("Playground engine");
    expect(num(await text(page, "pos-latency"))).toBeLessThan(300);

    expect(await text(page, "principal-value")).toBe(principal); // principal untouched
    expect(yieldBefore - (await money(page, "yield-value"))).toBeGreaterThan(4.5); // about $4.85 left the yield
  });

  test("POS: a swipe larger than the earned yield is declined, never borrowed", async ({ page }) => {
    await page.getByTestId("preset-apple").click(); // $149 against about $12 of yield on $5,000
    const principal = await text(page, "principal-value");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: EXCEEDS EARNED YIELD");
    await expect(page.getByTestId("pos-receipt")).toHaveCount(0);
    expect(await text(page, "principal-value")).toBe(principal);
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

  test("POS: monthly limit, earned-yield limit and invalid amount", async ({ page }) => {
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Big Purchase");
    await page.getByTestId("custom-amount").fill("4000");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: MONTHLY LIMIT EXCEEDED");

    await page.locator("#monthly-limit").fill("5000");
    await expect(page.getByTestId("monthly-limit-value")).toHaveText("$5,000");
    await page.getByTestId("custom-amount").fill("4400"); // within the monthly limit, far above the earned yield
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText("DECLINED: EXCEEDS EARNED YIELD");

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

  test("vouchers: paid from earned yield only, no credit option, codes match the format", async ({ page }) => {
    await openTab(page, /Voucher Store/);
    await expect(page.getByTestId("fund-yield")).toContainText("Earned Yield");
    await expect(page.getByTestId("fund-credit")).toHaveCount(0);
    for (const brand of ["Amazon", "Uber", "Swiggy", "Zomato"]) await expect(page.getByRole("button", { name: new RegExp(brand) }).first()).toBeVisible();

    await page.getByRole("button", { name: "$10 USD" }).click();
    await page.getByTestId("voucher-redeem").click(); // Amazon $10 from about $12 of yield
    const code = await text(page, "voucher-code");
    expect(code).toMatch(/^AMZN-YLD-\d{4}-[A-Z2-9]{4}$/);
    await expect(page.getByText("Not redeemable").first()).toBeVisible();

    await page.getByTestId("voucher-redeem").click(); // not enough yield left for a second one
    await expect(page.getByTestId("voucher-error")).toContainText("Only earned yield can be spent");

    await openTab(page, /Vault & Card/);
    await expect(page.getByTestId("principal-value")).toHaveText("$5,000.00"); // principal untouched
  });

  test("cashout: validates UPI/IBAN/ACH, only earned yield can be paid out, playground payout", async ({ page }) => {
    await openTab(page, /1-Click Bank/);
    await expect(page.getByTestId("allow-credit")).toHaveCount(0);
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
    await page.getByTestId("cashout-amount").fill("200"); // far more than the earned yield
    await page.getByTestId("cashout-dest").fill("name@oksbi");
    await page.getByTestId("cashout-submit").click();
    await expect(page.getByTestId("cashout-error")).toContainText("Only earned yield can be spent");

    await page.getByTestId("cashout-amount").fill("5");
    await page.getByTestId("cashout-submit").click();
    await expect(page.getByTestId("cashout-success")).toContainText("Payout of");
    await expect(page.getByTestId("cashout-success")).toContainText("no real money moved");
  });

  test("demo speed accrues yield from the principal, and the principal does not change", async ({ page }) => {
    const principal = await text(page, "principal-value");
    const before = await money(page, "yield-value");
    await page.getByTestId("speed-10000").click();
    await page.waitForTimeout(3000);
    expect(await money(page, "yield-value")).toBeGreaterThan(before);
    expect(await text(page, "principal-value")).toBe(principal);
  });

  test("principal: deposit adds to it, withdrawing more than it is refused, spend limit stays yield-backed", async ({ page }) => {
    const limitBefore = await money(page, "limit-value");
    await deposit(page, "1000");
    await expect(page.getByTestId("principal-value")).toHaveText("$6,000.00");
    // More principal does NOT raise what can be spent: the limit is the earned yield only
    expect(Math.abs((await money(page, "limit-value")) - limitBefore)).toBeLessThan(1);

    await page.getByTestId("open-withdraw").click();
    await page.getByTestId("withdraw-input").fill("9999");
    await page.getByTestId("withdraw-confirm").click();
    await expect(page.getByTestId("modal-error")).toContainText("more than your deposited principal");
    await page.getByRole("button", { name: "Cancel" }).click();

    await withdraw(page, "1000");
    await expect(page.getByTestId("principal-value")).toHaveText("$5,000.00");
  });

  test("no credit-line, advance, health-factor or collateral wording on any tab", async ({ page }) => {
    const banned = /micro-?buffer|credit (line|available|advance)|auto-?pilot|\bLTV\b|collateral|health factor:|liquidation \(|advance outstanding/i;
    for (const tab of [/Vault & Card/, /POS Terminal/, /Voucher Store/, /1-Click Bank/, /Ledger/]) {
      await openTab(page, tab);
      const body = (await page.locator("main").innerText()) ?? "";
      expect(body, `${tab}`).not.toMatch(banned);
    }
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
