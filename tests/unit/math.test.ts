import { describe, it, expect } from "vitest";
import { calculateAccruedYield } from "../../src/utils/math";

describe("Yield accrual maths", () => {
  it("is principal x APY x elapsed / year", () => {
    expect(calculateAccruedYield(1000, 5, 31_536_000)).toBeCloseTo(50, 6);
    expect(calculateAccruedYield(1000, 5, 31_536_000 / 2)).toBeCloseTo(25, 6);
  });
  it("is zero for no principal, no APY or no time (zero)", () => {
    expect(calculateAccruedYield(0, 5, 100)).toBe(0);
    expect(calculateAccruedYield(1000, 0, 100)).toBe(0);
    expect(calculateAccruedYield(1000, 5, 0)).toBe(0);
    expect(calculateAccruedYield(-5, 5, 100)).toBe(0);
  });
  it("handles dust and very large principals", () => {
    expect(calculateAccruedYield(0.01, 1, 1)).toBe(0); // rounds below 6 decimals
    expect(calculateAccruedYield(1e12, 10, 31_536_000)).toBe(1e11);
  });
});
