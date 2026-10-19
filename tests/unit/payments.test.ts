import { describe, it, expect } from "vitest";
import {
  maskDestination,
  validateAch,
  validateDestination,
  validateIban,
  validateRoutingNumber,
  validateUpi,
} from "../../src/utils/payments";
import { ASSETS, checkWithdraw, positionFromHoldings } from "../../src/utils/portfolio";

describe("UPI", () => {
  it.each(["name@oksbi", "first.last-1@ybl", "9876543210@paytm"])("accepts %s", (v) => {
    expect(validateUpi(v).ok).toBe(true);
  });
  it.each(["", "name", "name@", "@oksbi", "na me@ybl", "a@b"])("rejects %j", (v) => {
    expect(validateUpi(v).ok).toBe(false);
  });
  it("normalises case", () => {
    const r = validateUpi("  Name@OKSBI ");
    expect(r.ok && r.normalized).toBe("name@oksbi");
  });
});

describe("IBAN (mod-97)", () => {
  it.each(["DE89 3704 0044 0532 0130 00", "GB82 WEST 1234 5698 7654 32", "fr1420041010050500013m02606"])(
    "accepts %s",
    (v) => expect(validateIban(v).ok).toBe(true),
  );
  it("rejects a bad checksum, wrong length and unsupported country", () => {
    expect(validateIban("DE89 3704 0044 0532 0130 01").ok).toBe(false);
    expect(validateIban("DE89 3704 0044 0532 0130").ok).toBe(false);
    expect(validateIban("US64 SVBK US6S 3300 9589 0").ok).toBe(false);
    expect(validateIban("not an iban").ok).toBe(false);
  });
  it("formats in groups of four", () => {
    const r = validateIban("de89370400440532013000");
    expect(r.ok && r.normalized).toBe("DE89 3704 0044 0532 0130 00");
  });
});

describe("ACH", () => {
  it("validates routing checksum", () => {
    expect(validateRoutingNumber("021000021")).toBe(true);
    expect(validateRoutingNumber("021000022")).toBe(false);
    expect(validateRoutingNumber("12345")).toBe(false);
  });
  it("parses routing + account with several separators", () => {
    for (const v of ["021000021 123456789", "021000021/123456789", "021000021 - 123456789", "021000021,123456789"]) {
      const r = validateAch(v);
      expect(r.ok && r.normalized).toBe("021000021 / 123456789");
    }
  });
  it("rejects bad shapes", () => {
    expect(validateAch("021000021").ok).toBe(false);
    expect(validateAch("021000022 123456789").ok).toBe(false);
    expect(validateAch("021000021 12").ok).toBe(false);
  });
  it("dispatches by rail and masks destinations", () => {
    expect(validateDestination("upi", "a@b").ok).toBe(false);
    expect(validateDestination("sepa", "DE89 3704 0044 0532 0130 00").ok).toBe(true);
    expect(maskDestination("upi", "name@oksbi")).toBe("na***@oksbi");
    expect(maskDestination("sepa", "DE89 3704 0044 0532 0130 00")).toBe("••••3000");
  });
});

describe("portfolio", () => {
  const h = (weETH: number, USDC = 0, WETH = 0) => ({ weETH, USDC, WETH });
  const W = ASSETS.weETH;
  const U = ASSETS.USDC;

  it("uses Ether.fi's real risk parameters", () => {
    expect([W.maxLtv, W.liqThreshold]).toEqual([0.55, 0.75]);
    expect([U.maxLtv, U.liqThreshold]).toEqual([0.9, 0.95]);
    expect(ASSETS.WETH.maxLtv).toBe(0.55);
    for (const a of Object.values(ASSETS)) expect(a.liqThreshold).toBeGreaterThan(a.maxLtv);
  });

  it("values collateral with value-weighted LTV, liquidation threshold and APY", () => {
    const p = positionFromHoldings(h(2, 1000));
    const v = 2 * W.priceUsd + 1000;
    expect(p.collateralUsd).toBeCloseTo(v, 6);
    expect(p.maxLtv).toBeCloseTo((2 * W.priceUsd * W.maxLtv + 1000 * U.maxLtv) / v, 10);
    expect(p.liqThreshold).toBeCloseTo((2 * W.priceUsd * W.liqThreshold + 1000 * U.liqThreshold) / v, 10);
    expect(p.apyPercent).toBeCloseTo((2 * W.priceUsd * W.apyPercent + 1000 * U.apyPercent) / v, 10);
  });

  it("empty portfolio is zeroed", () => {
    expect(positionFromHoldings(h(0))).toEqual({ collateralUsd: 0, maxLtv: 0, liqThreshold: 0, apyPercent: 0 });
  });

  it("switching asset does not reinterpret the amount (2 weETH stays 2 x price)", () => {
    expect(positionFromHoldings(h(2)).collateralUsd).toBeCloseTo(2 * W.priceUsd, 6);
  });

  it("blocks a withdrawal that would leave debt above the LTV borrow limit", () => {
    const holdings = h(2); // 5,362 collateral -> 2,949 borrow limit
    expect(checkWithdraw(holdings, "weETH", 0.5, 2000).ok).toBe(true);
    const bad = checkWithdraw(holdings, "weETH", 1.5, 2000);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/borrow limit/);
  });

  it("blocks a withdrawal that would push HF below 1.20x even when LTV still covers the debt", () => {
    // 1000 USDC, debt 700: withdrawing 130 leaves 870 (LTV cap 783 >= 700) but HF = 870*.95/700 = 1.18x
    expect(checkWithdraw(h(0, 1000), "USDC", 100, 700).ok).toBe(true);
    const bad = checkWithdraw(h(0, 1000), "USDC", 130, 700);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/1\.20x/);
  });

  it("allows full withdrawal with no debt; rejects more than held", () => {
    expect(checkWithdraw(h(2), "weETH", 2, 0).ok).toBe(true);
    expect(checkWithdraw(h(2), "weETH", 2.01, 0).ok).toBe(false);
    expect(checkWithdraw(h(2), "weETH", 0, 0).ok).toBe(false);
  });
});
