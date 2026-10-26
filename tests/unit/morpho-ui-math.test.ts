import { describe, expect, it } from "vitest";
import { fmtUsdc, fmtUsdcFull, parseUsdcInput } from "../../src/lib/aave/format";
import { parseApyResponse, tickYield } from "../../src/lib/morpho/apy";

const VAULT = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";

describe("MAX button: the amount typed for MAX parses back to exactly the balance (6-decimal USDG)", () => {
  const samples = [0n, 1n, 9n, 10n, 999_999n, 1_000_000n, 1_000_001n, 123_456_789n, 1_000_000_000n, 543_803_571_732_430n, 2n ** 64n, 2n ** 128n - 1n];
  it("fmtUsdcFull -> parseUsdcInput is lossless for zero, dust, whole and huge values", () => {
    for (const v of samples) expect(parseUsdcInput(fmtUsdcFull(v))).toBe(v);
  });
  it("dust shows all six decimals; whole numbers show none; no float rounding", () => {
    expect(fmtUsdcFull(1n)).toBe("0.000001");
    expect(fmtUsdcFull(1_500_000n)).toBe("1.5");
    expect(fmtUsdcFull(7_000_000n)).toBe("7");
    expect(fmtUsdcFull(0n)).toBe("0");
    expect(fmtUsdcFull(9_007_199_254_740_993_000_000n)).toBe("9007199254740993"); // beyond 2^53: still exact
  });
  it("a pseudo-random sweep never mismatches by even one base unit", () => {
    let x = 12345n;
    for (let i = 0; i < 2000; i++) {
      x = (x * 6364136223846793005n + 1442695040888963407n) % 2n ** 96n;
      expect(parseUsdcInput(fmtUsdcFull(x))).toBe(x);
    }
  });
  it("the display format truncates, it never rounds up past what exists", () => {
    expect(fmtUsdc(999_999n)).toBe("0.99");
    expect(fmtUsdc(1_999_999n)).toBe("1.99");
  });
  it("more than 6 decimals is rejected, not rounded (an 18-decimal amount cannot sneak in)", () => {
    expect(parseUsdcInput("1.0000001")).toBeNull();
    expect(parseUsdcInput("0.000000000000000001")).toBeNull();
    expect(parseUsdcInput("-1")).toBeNull();
    expect(parseUsdcInput("")).toBeNull();
  });
});

describe("parseApyResponse: only the allowlisted vault, only a sane number", () => {
  const ok = (items: unknown) => ({ data: { vaultV2s: { items } } });
  it("reads netApy of the allowlisted vault (case-insensitive address)", () => {
    expect(parseApyResponse(ok([{ address: VAULT.toLowerCase(), netApy: 0.0384 }]))).toBe(0.0384);
  });
  it("ignores other vaults, missing or absurd values, and malformed bodies", () => {
    expect(parseApyResponse(ok([{ address: "0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8", netApy: 0.2 }]))).toBeNull();
    expect(parseApyResponse(ok([{ address: VAULT, netApy: -0.05 }]))).toBeNull();
    expect(parseApyResponse(ok([{ address: VAULT, netApy: 7 }]))).toBeNull();
    expect(parseApyResponse(ok([{ address: VAULT, netApy: Number.NaN }]))).toBeNull();
    expect(parseApyResponse(ok([{ address: VAULT }]))).toBeNull();
    expect(parseApyResponse(ok([]))).toBeNull();
    expect(parseApyResponse(null)).toBeNull();
    expect(parseApyResponse({ errors: [{ message: "x" }] })).toBeNull();
  });
});

describe("tickYield: display-only live yield", () => {
  it("adds what the position earns per second at the APY, on top of the read yield", () => {
    // 1,000 USDG at 3.65% for 1 day = 0.1 USDG
    expect(tickYield(5_000_000n, 1_000_000_000n, 0.0365, 86_400_000)).toBe(5_000_000n + 100_000n);
  });
  it("with no APY, no elapsed time or no position it shows exactly the read yield; never negative", () => {
    expect(tickYield(5n, 100n, null, 10_000)).toBe(5n);
    expect(tickYield(5n, 100n, 0.04, 0)).toBe(5n);
    expect(tickYield(5n, 0n, 0.04, 10_000)).toBe(5n);
    expect(tickYield(-3n, 100n, 0.04, 10_000)).toBe(0n);
  });
});
