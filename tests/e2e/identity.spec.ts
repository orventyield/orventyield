import { expect, test } from "@playwright/test";
import { DEMO_CODE, activateCard, connectForkWallet, pickCountry } from "./helpers";

test.describe("mobile OTP verification and one user = one card", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await connectForkWallet(page);
  });

  test.afterEach(() => expect(errors).toEqual([]));

  test("the activation dialog opens with a custom glass country picker, number field and a clear promise", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    const dialog = page.getByRole("dialog", { name: "Activate your card" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("phone-input")).toBeFocused();

    // Not a native <select>: it is a themed combobox with a searchable list
    await expect(dialog.locator("select")).toHaveCount(0);
    const trigger = page.getByTestId("phone-country");
    await expect(trigger).toHaveAttribute("role", "combobox");
    await trigger.click();
    const panel = page.getByTestId("phone-country-panel");
    await expect(panel).toBeVisible();
    for (const iso of ["IN", "US", "GB"]) await expect(page.getByTestId(`country-option-${iso}`)).toHaveCount(1);
    expect(await page.locator('[data-testid^="country-option-"]').count()).toBeGreaterThan(200);
    // The panel is dark glass, not the browser's white menu
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b2] = (bg.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    expect(Math.max(r!, g!, b2!)).toBeLessThan(60);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(dialog).toBeVisible(); // Escape closed only the dropdown
    await expect(dialog).toContainText("One verified person, one card");
    await expect(dialog).toContainText("never store your number");
  });

  test("country picker: search by name or code, keyboard selection, selected value shows flag and dial code", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    const trigger = page.getByTestId("phone-country");
    await trigger.click();
    await expect(page.getByTestId("phone-country-search")).toBeFocused();

    await page.getByTestId("phone-country-search").fill("united k");
    await expect(page.getByTestId("country-option-GB")).toBeVisible();
    await expect(page.getByTestId("country-option-IN")).toHaveCount(0);
    await page.getByTestId("phone-country-search").fill("zzzz");
    await expect(page.getByText("No country matches")).toBeVisible();

    await page.getByTestId("phone-country-search").fill("+91");
    await expect(page.getByTestId("country-option-IN")).toBeVisible();
    await page.keyboard.press("Enter"); // the first match
    await expect(page.getByTestId("phone-country-panel")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("data-value", "IN");
    await expect(trigger).toContainText("+91");
    await expect(trigger).toBeFocused(); // focus returns to the trigger

    // arrow keys + Enter
    await trigger.press("ArrowDown");
    await page.getByTestId("phone-country-search").fill("france");
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("data-value", "FR");
    await expect(page.getByTestId("phone-preview")).toContainText("Standard SMS rates"); // nothing typed yet
  });

  test("country picker stays inside the phone screen: no horizontal scroll and it opens fully on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.getByTestId("card-verify-phone").click();
    await page.getByTestId("phone-country").click();
    const box = await page.getByTestId("phone-country-panel").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId("country-option-IN").click();
    await expect(page.getByTestId("phone-country")).toHaveAttribute("data-value", "IN");
  });

  test("phone validation: empty, letters, wrong length, landline, and a live E.164 preview", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    await pickCountry(page, "IN");

    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toHaveText("Enter your mobile number.");

    await page.getByTestId("phone-input").fill("98x65");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toContainText("international format");

    await page.getByTestId("phone-input").fill("12345");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toContainText("valid phone number");

    await pickCountry(page, "GB");
    await page.getByTestId("phone-input").fill("020 7183 8750"); // London landline
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toContainText("mobile number that can receive SMS");

    await pickCountry(page, "IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await expect(page.getByTestId("phone-preview")).toContainText("+919876543210");
    await expect(page.getByTestId("phone-error")).toHaveCount(0);
  });

  test("OTP step: masked number, auto-focus, resend countdown, wrong code, then success moves on to the issuer sign-in", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    await pickCountry(page, "IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await page.getByTestId("phone-submit").click();

    await expect(page.getByTestId("otp-step")).toBeVisible();
    await expect(page.getByTestId("otp-sent-to")).toHaveText("+91 ••••••3210");
    await expect(page.getByTestId("otp-input")).toBeFocused();
    await expect(page.getByTestId("otp-input")).toHaveAttribute("autocomplete", "one-time-code");
    await expect(page.getByTestId("otp-input")).toHaveAttribute("inputmode", "numeric");
    await expect(page.getByTestId("otp-hint")).toContainText(DEMO_CODE);

    // Resend is locked behind a countdown that actually counts down.
    const resend = page.getByTestId("otp-resend");
    await expect(resend).toBeDisabled();
    await expect(resend).toHaveText(/Resend code in (29|30)s/);
    await page.waitForTimeout(2200);
    const t = Number(((await resend.textContent()) ?? "").match(/(\d+)s/)?.[1]);
    expect(t).toBeLessThanOrEqual(28);

    // Wrong code: error, attempts left, input cleared and refocused.
    await page.getByTestId("otp-input").fill("000000");
    await expect(page.getByTestId("otp-error")).toContainText("That code isn't right");
    await expect(page.getByTestId("otp-error")).toContainText("4 attempts left");
    await expect(page.getByTestId("otp-input")).toHaveValue("");

    // Right code, typed digit by digit: verifies automatically on the sixth digit.
    await page.getByTestId("otp-input").pressSequentially(DEMO_CODE, { delay: 40 });
    await expect(page.getByTestId("otp-dialog")).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId("card-step-login")).toBeVisible(); // next: sign in to the card issuer
  });

  test("pasting the code works, including spaces", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    await pickCountry(page, "GB");
    await page.getByTestId("phone-input").fill("07911 123456");
    await page.getByTestId("phone-submit").click();
    await page.getByTestId("otp-input").evaluate((el: HTMLInputElement, v) => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, "123 456");
    await expect(page.getByTestId("card-step-login")).toBeVisible();
  });

  test("five wrong codes lock the session and ask for a new code", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    await pickCountry(page, "IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await page.getByTestId("phone-submit").click();
    for (let i = 0; i < 5; i++) {
      await page.getByTestId("otp-input").fill("000000");
      await expect(page.getByTestId("otp-error")).toBeVisible();
    }
    await expect(page.getByTestId("otp-error")).toContainText("Too many incorrect codes");
    await expect(page.getByTestId("card-verify-phone")).toBeVisible();
  });

  test("activation survives a reload", async ({ page }) => {
    await activateCard(page);
    await page.reload();
    // The test wallet forgets its authorisation on reload, so connect again; the verified phone comes back from storage.
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("card-step-login")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("card-verify-phone")).toHaveCount(0);
  });

  test("a number the account has not used yet works as before (no re-link note)", async ({ page }) => {
    await page.getByTestId("card-verify-phone").click();
    await pickCountry(page, "GB");
    await page.getByTestId("phone-input").fill("07911 123456");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("otp-step")).toBeVisible();
    await expect(page.getByTestId("relink-note")).toHaveCount(0);
    await page.getByTestId("otp-input").fill(DEMO_CODE);
    await expect(page.getByTestId("card-step-login")).toBeVisible();
  });

  test("Escape closes the dialog, focus returns to the button, and Tab stays inside", async ({ page }) => {
    const opener = page.getByTestId("card-verify-phone");
    await opener.click();
    await expect(page.getByTestId("otp-dialog")).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("otp-dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("mobile: bottom sheet, 44px+ controls, no horizontal scroll through the whole flow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("card-verify-phone").scrollIntoViewIfNeeded();
    await page.getByTestId("card-verify-phone").click();
    const dialog = page.getByRole("dialog");
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    expect(box.y + box.height).toBeGreaterThan(800);
    for (const id of ["phone-country", "phone-input", "phone-submit"]) {
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await pickCountry(page, "IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("otp-step")).toBeVisible();
    expect((await page.getByTestId("otp-cell-0").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
