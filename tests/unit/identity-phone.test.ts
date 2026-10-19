import { describe, expect, it } from "vitest";
import { ipKey, phoneHash, safeEqual } from "../../src/lib/identity/hash";
import { guessCountry, listCountries, maskPhone, normalizePhone, validateE164 } from "../../src/lib/identity/phone";

describe("E.164 validation", () => {
  it.each(["+447911123456", "+919876543210", "+14155552671", "+4915112345678", "+5511987654321"])("accepts %s", (n) => {
    const r = validateE164(n);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe(n);
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["9876543210", "INVALID_FORMAT"], // no plus
    ["+0123456789", "INVALID_FORMAT"], // leading zero after +
    ["+91 98765 43210", "INVALID_FORMAT"], // spaces are not E.164
    ["+1234567890123456", "INVALID_FORMAT"], // 16 digits
    ["+12345", "INVALID_FORMAT"], // too short
    ["+4478", "INVALID_FORMAT"],
    ["+919999999999999", "INVALID_NUMBER"],
    ["+1 (415) 555-2671", "INVALID_FORMAT"],
    ["+44abc", "INVALID_FORMAT"],
  ])("rejects %j as %s", (n, code) => {
    const r = validateE164(n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("rejects numbers that cannot receive an SMS (landline, toll-free)", () => {
    for (const n of ["+442071838750", "+911234567890", "+18005551234"]) {
      const r = validateE164(n);
      expect(r.ok, n).toBe(false);
      if (!r.ok) expect(r.code).toBe("NOT_MOBILE");
    }
  });

  it("restricts to allowed countries when configured", () => {
    expect(validateE164("+447911123456", ["IN", "US"]).ok).toBe(false);
    expect(validateE164("+919876543210", ["IN", "US"]).ok).toBe(true);
    const r = validateE164("+447911123456", ["IN"]);
    if (!r.ok) expect(r.code).toBe("COUNTRY_NOT_ALLOWED");
  });
});

describe("normalizePhone (country + national number as typed)", () => {
  it("accepts spaces, dashes and a trunk zero", () => {
    expect(normalizePhone({ country: "GB", national: "07911 123456" })).toMatchObject({ ok: true, e164: "+447911123456" });
    expect(normalizePhone({ country: "IN", national: "98765-43210" })).toMatchObject({ ok: true, e164: "+919876543210" });
    expect(normalizePhone({ country: "US", national: "(415) 555-2671" })).toMatchObject({ ok: true, e164: "+14155552671" });
  });
  it("rejects empty, letters and numbers invalid for the country", () => {
    expect(normalizePhone({ country: "IN", national: "" })).toMatchObject({ ok: false, code: "EMPTY" });
    expect(normalizePhone({ country: "IN", national: "98x65 43210" })).toMatchObject({ ok: false, code: "INVALID_FORMAT" });
    expect(normalizePhone({ country: "IN", national: "12345" })).toMatchObject({ ok: false });
    expect(normalizePhone({ country: "GB", national: "02071838750" })).toMatchObject({ ok: false, code: "NOT_MOBILE" });
  });
});

describe("countries and masking", () => {
  it("lists every country with a dial code, a name and a flag", () => {
    const list = listCountries();
    expect(list.length).toBeGreaterThan(200);
    const india = list.find((c) => c.iso === "IN")!;
    expect(india).toMatchObject({ name: "India", dial: "+91" });
    expect(india.flag).toBe("🇮🇳");
    expect(list.find((c) => c.iso === "US")!.dial).toBe("+1");
    expect(list.find((c) => c.iso === "GB")!.dial).toBe("+44");
    const names = list.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("masks all but the last four digits", () => {
    expect(maskPhone("+919876543210")).toBe("+91 ••••••3210");
    expect(maskPhone("+447911123456")).toMatch(/^\+44 •+3456$/);
    expect(maskPhone("+14155552671")).not.toContain("415");
  });
  it("guesses the country from a locale", () => {
    expect(guessCountry("en-IN")).toBe("IN");
    expect(guessCountry("pt-BR")).toBe("BR");
    expect(guessCountry("en")).toBe("US");
    expect(guessCountry(undefined)).toBe("US");
  });
});

describe("privacy hashes", () => {
  it("is deterministic, keyed by the secret, and hides the number", async () => {
    const a = await phoneHash("pepper-1", "+919876543210");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await phoneHash("pepper-1", "+919876543210")).toBe(a);
    expect(await phoneHash("pepper-2", "+919876543210")).not.toBe(a);
    expect(await phoneHash("pepper-1", "+919876543211")).not.toBe(a);
    expect(a).not.toContain("9876543210");
  });
  it("domain-separates phone and ip hashes", async () => {
    expect(await phoneHash("p", "1.2.3.4")).not.toBe(await ipKey("p", "1.2.3.4"));
  });
  it("refuses an empty secret", async () => {
    await expect(phoneHash("", "+919876543210")).rejects.toThrow();
  });
  it("compares in constant time and correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
