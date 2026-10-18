import { describe, it, expect } from "vitest";
import {
  calculateAvailableLimit,
  calculateHealthFactor,
  getHealthStatus,
  calculateAccruedYield,
  calculateMicroBuffer
} from "../../src/utils/math";

describe("Financial Math Formulas", () => {
  it("calculates available spending limit correctly", () => {
    // $1,000 collateral at 75% max LTV = $750 max borrow
    // With $200 existing debt -> $550 available
    expect(calculateAvailableLimit(1000, 200, 0.75)).toBe(550);

    // When debt exceeds max LTV, available limit is 0 (never negative)
    expect(calculateAvailableLimit(1000, 800, 0.75)).toBe(0);

    // When collateral is 0
    expect(calculateAvailableLimit(0, 50, 0.75)).toBe(0);
  });

  it("calculates health factor and risk status according to PRD", () => {
    // Zero debt -> infinite health
    expect(calculateHealthFactor(1000, 0, 0.75)).toBe(999);
    expect(getHealthStatus(999).status).toBe("safe");

    // Collateral $1000, LTV 0.75 -> maxBorrow = 750
    // Debt = $375 -> health factor = 750 / 375 = 2.0x (Safe)
    expect(calculateHealthFactor(1000, 375, 0.75)).toBe(2);
    expect(getHealthStatus(2.0).status).toBe("safe");

    // Debt = $550 -> health factor = 750 / 550 = 1.36x (Warning)
    const warningHF = calculateHealthFactor(1000, 550, 0.75);
    expect(warningHF).toBe(1.36);
    expect(getHealthStatus(warningHF).status).toBe("warning");

    // Debt = $700 -> health factor = 750 / 700 = 1.07x (Danger)
    const dangerHF = calculateHealthFactor(1000, 700, 0.75);
    expect(dangerHF).toBe(1.07);
    expect(getHealthStatus(dangerHF).status).toBe("danger");
  });

  it("calculates continuous accrued yield over time", () => {
    const principal = 10000;
    const apy = 8.0; // 8% per year = $800 / year
    const halfYearSeconds = 31536000 / 2;
    const yieldHalfYear = calculateAccruedYield(principal, apy, halfYearSeconds);
    expect(yieldHalfYear).toBeCloseTo(400, 1);
  });

  it("calculates rolling 7-day predictive micro-buffer", () => {
    const collateral = 1000;
    const apy = 8.0; // 8% = $80/year = $0.219/day = ~$1.53 in 7 days
    const buffer = calculateMicroBuffer(collateral, apy, 7);
    expect(buffer).toBeCloseTo(1.53, 1);
  });
});
