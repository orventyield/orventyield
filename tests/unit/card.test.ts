import { describe, it, expect } from "vitest";
import {
  authCode,
  cardExpiry,
  detectNetwork,
  formatPan,
  generateCardDetails,
  generateVoucherCode,
  isLuhnValid,
  luhnCheckDigit,
  shortHash,
  simTxHash,
} from "../../src/utils/card";

describe("Luhn", () => {
  it("validates known test PANs and rejects corrupted ones", () => {
    expect(isLuhnValid("4111111111111111")).toBe(true);
    expect(isLuhnValid("5555555555554444")).toBe(true);
    expect(isLuhnValid("4111111111111112")).toBe(false);
    expect(isLuhnValid("abcd")).toBe(false);
  });
  it("computes the check digit", () => {
    expect(luhnCheckDigit("411111111111111")).toBe(1);
    expect(luhnCheckDigit("555555555555444")).toBe(4);
  });
});

describe("generateCardDetails", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  it("is deterministic for a seed and differs between seeds", () => {
    const a = generateCardDetails("0xabc", now);
    expect(generateCardDetails("0xabc", now)).toEqual(a);
    expect(generateCardDetails("0xdef", now).pan).not.toBe(a.pan);
  });
  it.each(["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "demo", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"])(
    "produces a Luhn-valid 16-digit PAN, 3-digit CVV and a matching network for %s",
    (seed) => {
      const c = generateCardDetails(seed, now);
      expect(c.pan).toMatch(/^\d{16}$/);
      expect(isLuhnValid(c.pan)).toBe(true);
      expect(c.cvv).toMatch(/^\d{3}$/);
      expect(detectNetwork(c.pan)).toBe(c.network);
    },
  );
  it("covers both networks across seeds", () => {
    const nets = new Set(Array.from({ length: 40 }, (_, i) => generateCardDetails(`s${i}`, now).network));
    expect(nets).toEqual(new Set(["visa", "mastercard"]));
  });
  it("expiry is MM/YY, 4 years out", () => {
    expect(cardExpiry(now)).toBe("10/30");
    expect(cardExpiry(new Date("2026-01-05T00:00:00Z"))).toBe("01/30");
    expect(generateCardDetails("x", now).expiry).toBe("10/30");
  });
});

describe("formatPan", () => {
  it("masks all but the last group; reveals on demand", () => {
    expect(formatPan("4000001234567890", false)).toBe("•••• •••• •••• 7890");
    expect(formatPan("4000001234567890", true)).toBe("4000 0012 3456 7890");
  });
});

describe("voucher codes and hashes", () => {
  it("matches the documented format, e.g. AMZN-YLD-8942-X7F1", () => {
    const code = generateVoucherCode("amazon", "tx-1");
    expect(code).toMatch(/^AMZN-YLD-\d{4}-[A-Z2-9]{4}$/);
    expect(generateVoucherCode("uber", "x")).toMatch(/^UBER-YLD-/);
    expect(generateVoucherCode("swiggy", "x")).toMatch(/^SWGY-YLD-/);
    expect(generateVoucherCode("zomato", "x")).toMatch(/^ZMTO-YLD-/);
  });
  it("is unique per seed and stable for the same seed", () => {
    expect(generateVoucherCode("amazon", "a")).toBe(generateVoucherCode("amazon", "a"));
    const codes = new Set(Array.from({ length: 200 }, (_, i) => generateVoucherCode("amazon", `s${i}`)));
    expect(codes.size).toBe(200);
  });
  it("simulated tx hash is 32 bytes and shortens for display", () => {
    const h = simTxHash("a");
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(simTxHash("a")).toBe(h);
    expect(simTxHash("b")).not.toBe(h);
    expect(shortHash(h)).toMatch(/^0x[0-9a-f]{8}…[0-9a-f]{8}$/);
  });
  it("auth code is 6 digits", () => {
    expect(authCode("seed")).toMatch(/^\d{6}$/);
  });
});
