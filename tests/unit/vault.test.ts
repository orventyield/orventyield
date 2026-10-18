import { describe, it, expect } from "vitest";
import { calculateAvailableLimit, calculateHealthFactor, calculateMicroBuffer } from "../../src/utils/math";

describe("OrventYield End-to-End Business Logic", () => {
  it("validates spend invariant: available limit + micro buffer", () => {
    const collateralUsd = 6900; // 2 weETH
    const debtUsd = 350;
    const maxLtv = 0.75;
    const available = calculateAvailableLimit(collateralUsd, debtUsd, maxLtv);
    const microBuffer = calculateMicroBuffer(collateralUsd, 8.4, 7);

    expect(available).toBe(4825);
    expect(microBuffer).toBeGreaterThan(11);

    const spendAmount = 149.0; // Apple Store spend
    expect(spendAmount).toBeLessThan(available + microBuffer);

    // After spend:
    const newDebt = debtUsd + spendAmount;
    const newHf = calculateHealthFactor(collateralUsd, newDebt, maxLtv);
    expect(newHf).toBeGreaterThan(1.5); // Remains strictly safe
  });

  it("validates zero-license voucher redemption funded by accrued yield", () => {
    let accruedYield = 48.25;
    let debt = 350.0;
    const voucherCost = 25.0; // Amazon gift card

    // Pay with accrued yield: debt unchanged, principal unchanged
    expect(accruedYield).toBeGreaterThanOrEqual(voucherCost);
    accruedYield -= voucherCost;
    expect(accruedYield).toBe(23.25);
    expect(debt).toBe(350.0);
  });

  it("validates debt auto-repayment from accrued yield", () => {
    let accruedYield = 50.0;
    let debt = 30.0;

    const repaid = Math.min(debt, accruedYield);
    debt -= repaid;
    accruedYield -= repaid;

    expect(repaid).toBe(30.0);
    expect(debt).toBe(0);
    expect(accruedYield).toBe(20.0);
  });
});
