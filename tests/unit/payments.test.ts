import { describe, it, expect } from "vitest";
import {
  maskDestination,
  validateAch,
  validateDestination,
  validateIban,
  validateRoutingNumber,
  validateUpi,
} from "../../src/utils/payments";

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
