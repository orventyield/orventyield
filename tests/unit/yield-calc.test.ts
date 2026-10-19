import { describe, expect, it } from "vitest";
import { coverage, monthlyYield, principalNeeded, spendPlan, yearlyYield } from "../../src/utils/yieldCalc";

describe("yield maths", () => {
  it("is zero for zero, negative or missing inputs", () => {
    expect(yearlyYield(0, 5)).toBe(0);
    expect(yearlyYield(1000, 0)).toBe(0);
    expect(yearlyYield(-1000, 5)).toBe(0);
    expect(yearlyYield(1000, -5)).toBe(0);
    expect(monthlyYield(0, 0)).toBe(0);
  });
  it("computes yearly and monthly yield", () => {
    expect(yearlyYield(50_000, 3.5)).toBeCloseTo(1750, 9);
    expect(monthlyYield(50_000, 3.5)).toBeCloseTo(145.8333333, 6);
  });
  it("handles dust and very large principals", () => {
    expect(yearlyYield(0.01, 1)).toBeCloseTo(0.0001, 12);
    expect(yearlyYield(1e12, 10)).toBe(1e11);
  });
});

describe("principalNeeded", () => {
  it("is the principal whose yield covers the spend", () => {
    expect(principalNeeded(100, 4)).toBeCloseTo(30_000, 6);
    expect(monthlyYield(principalNeeded(250, 5), 5)).toBeCloseTo(250, 9);
  });
  it("is zero with no spend and Infinity with spend but no yield", () => {
    expect(principalNeeded(0, 4)).toBe(0);
    expect(principalNeeded(-5, 4)).toBe(0);
    expect(principalNeeded(100, 0)).toBe(Infinity);
  });
});

describe("coverage and spendPlan: spending can never exceed yield", () => {
  it("covers fully when yield exceeds the wish", () => {
    expect(coverage(100_000, 5, 100)).toBe(1);
    expect(spendPlan(100_000, 5, 100)).toEqual({ spendable: 100, shortfall: 0 });
  });
  it("caps at the yield and reports the shortfall, never touching principal", () => {
    const y = monthlyYield(10_000, 3); // 25
    expect(spendPlan(10_000, 3, 100)).toEqual({ spendable: y, shortfall: 100 - y });
    expect(coverage(10_000, 3, 100)).toBeCloseTo(0.25, 12);
  });
  it("a zero wish is fully covered; zero principal covers nothing", () => {
    expect(coverage(1000, 4, 0)).toBe(1);
    expect(spendPlan(0, 4, 50)).toEqual({ spendable: 0, shortfall: 50 });
  });
});
