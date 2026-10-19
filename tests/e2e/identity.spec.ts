import { expect, test } from "@playwright/test";
import { DEMO_CODE, activateCard } from "./helpers";

test.describe("mobile OTP verification and one user = one card", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto("/dashboard");
    await expect(page.getByTestId("card-locked")).toBeVisible();
  });

  test.afterEach(() => expect(errors).toEqual([]));

  test("the activation dialog opens with a country dropdown, number field and a clear promise", async ({ page }) => {
    await page.getByTestId("card-activate").click();
    const dialog = page.getByRole("dialog", { name: "Activate your card" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("phone-input")).toBeFocused();

    const select = page.getByTestId("phone-country");
    for (const label of [/India.*\+91/, /United States.*\+1\)/, /United Kingdom.*\+44/]) {
      await expect(select.locator("option", { hasText: label })).toHaveCount(1);
    }
    expect(await select.locator("option").count()).toBeGreaterThan(200);
    await expect(dialog).toContainText("One verified person, one card");
    await expect(dialog).toContainText("never store your number");
  });

  test("phone validation: empty, letters, wrong length, landline, and a live E.164 preview", async ({ page }) => {
    await page.getByTestId("card-activate").click();
    await page.getByTestId("phone-country").selectOption("IN");

    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toHaveText("Enter your mobile number.");

    await page.getByTestId("phone-input").fill("98x65");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toContainText("international format");

    await page.getByTestId("phone-input").fill("12345");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toContainText("valid phone number");

    await page.getByTestId("phone-country").selectOption("GB");
    await page.getByTestId("phone-input").fill("020 7183 8750"); // London landline
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("phone-error")).toContainText("mobile number that can receive SMS");

    await page.getByTestId("phone-country").selectOption("IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await expect(page.getByTestId("phone-preview")).toContainText("+919876543210");
    await expect(page.getByTestId("phone-error")).toHaveCount(0);
  });

  test("OTP step: masked number, auto-focus, resend countdown, wrong code, then success unlocks the card", async ({ page }) => {
    await page.getByTestId("card-activate").click();
    await page.getByTestId("phone-country").selectOption("IN");
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
    await expect(page.getByTestId("activation-success")).toBeVisible();
    await expect(page.getByTestId("card-unlocked")).toBeVisible();
    await expect(page.getByTestId("card-status")).toHaveText("ACTIVE");
    await expect(page.getByTestId("otp-dialog")).toHaveCount(0, { timeout: 5000 });

    // The unlocked card works: reveal, flip, and a swipe is approved.
    await page.getByTestId("pan-toggle").click();
    await expect(page.getByTestId("card-pan")).toHaveText(/^\d{4} \d{4} \d{4} \d{4}$/);
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
  });

  test("pasting the code works, including spaces", async ({ page }) => {
    await page.getByTestId("card-activate").click();
    await page.getByTestId("phone-country").selectOption("GB");
    await page.getByTestId("phone-input").fill("07911 123456");
    await page.getByTestId("phone-submit").click();
    await page.getByTestId("otp-input").evaluate((el: HTMLInputElement, v) => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, "123 456");
    await expect(page.getByTestId("card-unlocked")).toBeVisible();
  });

  test("five wrong codes lock the session and ask for a new code", async ({ page }) => {
    await page.getByTestId("card-activate").click();
    await page.getByTestId("phone-country").selectOption("IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await page.getByTestId("phone-submit").click();
    for (let i = 0; i < 5; i++) {
      await page.getByTestId("otp-input").fill("000000");
      await expect(page.getByTestId("otp-error")).toBeVisible();
    }
    await expect(page.getByTestId("otp-error")).toContainText("Too many incorrect codes");
    await expect(page.getByTestId("card-locked")).toBeVisible();
  });

  test("activation survives a reload", async ({ page }) => {
    await activateCard(page);
    await page.reload();
    await expect(page.getByTestId("card-unlocked")).toBeVisible();
    await expect(page.getByTestId("card-locked")).toHaveCount(0);
  });

  test("the same number cannot activate a second card for a different account", async ({ page }) => {
    await activateCard(page);
    // Become "another wallet": a fresh account id, but the same browser registry (the demo stand-in for a shared one).
    await page.evaluate(() => {
      window.localStorage.removeItem("oy.guest");
      for (const k of Object.keys(window.localStorage)) if (k.startsWith("oy.card.")) window.localStorage.removeItem(k);
    });
    await page.reload();
    await expect(page.getByTestId("card-locked")).toBeVisible();

    await page.getByTestId("card-activate").click();
    await page.getByTestId("phone-country").selectOption("IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await page.getByTestId("phone-submit").click();

    const dup = page.getByTestId("dup-error");
    await expect(dup).toBeVisible();
    await expect(dup).toHaveText("Card already active for this verified identity.");
    await expect(page.getByTestId("otp-step")).toHaveCount(0); // no SMS step was offered
    await page.getByTestId("otp-close").click();
    await expect(page.getByTestId("card-locked")).toBeVisible();

    // A different number works for the new account.
    await page.getByTestId("card-activate").click();
    await page.getByTestId("phone-country").selectOption("GB");
    await page.getByTestId("phone-input").fill("07911 123456");
    await page.getByTestId("phone-submit").click();
    await page.getByTestId("otp-input").fill(DEMO_CODE);
    await expect(page.getByTestId("card-unlocked")).toBeVisible();
  });

  test("Escape closes the dialog, focus returns to the button, and Tab stays inside", async ({ page }) => {
    const opener = page.getByTestId("card-activate");
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
    await page.getByTestId("card-activate").scrollIntoViewIfNeeded();
    await page.getByTestId("card-activate").click();
    const dialog = page.getByRole("dialog");
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    expect(box.y + box.height).toBeGreaterThan(800);
    for (const id of ["phone-country", "phone-input", "phone-submit"]) {
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId("phone-country").selectOption("IN");
    await page.getByTestId("phone-input").fill("98765 43210");
    await page.getByTestId("phone-submit").click();
    await expect(page.getByTestId("otp-step")).toBeVisible();
    expect((await page.getByTestId("otp-cell-0").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
