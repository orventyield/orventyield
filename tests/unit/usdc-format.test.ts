import { describe, expect, it } from "vitest";
import { fmtUsdc, fmtUsdc4, parseUsdcInput } from "../../src/lib/aave/format";

describe("parseUsdcInput", () => {
  it("parses whole and fractional amounts exactly", () => {
    expect(parseUsdcInput("1")).toBe(1_000_000n);
    expect(parseUsdcInput("12.5")).toBe(12_500_000n);
    expect(parseUsdcInput("0.000001")).toBe(1n); // dust
    expect(parseUsdcInput(" 7. ")).toBe(7_000_000n);
    expect(parseUsdcInput("0")).toBe(0n);
  });
  it("rejects invalid input", () => {
    for (const bad of ["", "-1", "1e3", "abc", "1.0000001", "1,5", "NaN", "Infinity", ".5"]) expect(parseUsdcInput(bad)).toBeNull();
  });
  it("is exact at very large values (no float rounding)", () => {
    expect(parseUsdcInput("9007199254740993.000001")).toBe(9007199254740993_000001n);
  });
});

describe("format", () => {
  it("formats with thousands separators and truncates rather than rounds up", () => {
    expect(fmtUsdc(1_234_567_890n)).toBe("1,234.56");
    expect(fmtUsdc(999_999n)).toBe("0.99");
    expect(fmtUsdc(0n)).toBe("0.00");
    expect(fmtUsdc4(1_908_755n)).toBe("1.9087");
  });
});
