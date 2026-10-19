import { describe, expect, it } from "vitest";
import { valueHoldings } from "../../src/lib/etherfi/walletHoldings";

const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
const WEETH = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF" as const;

describe("valueHoldings", () => {
  it("values balances with the oracle price and Ether.fi's LTVs", () => {
    const v = valueHoldings([
      { symbol: "USDC", address: USDC, decimals: 6, rawBalance: 1_000_000_000n, price6: 1_000_000n }, // $1,000 at 90%
      { symbol: "weETH", address: WEETH, decimals: 18, rawBalance: 2n * 10n ** 18n, price6: 2_681_146_651n }, // 2 x $2,681.15 at 55%
    ]);
    expect(v.totalUsd).toBeCloseTo(1000 + 2 * 2681.146651, 4);
    expect(v.borrowPowerUsd).toBeCloseTo(1000 * 0.9 + 2 * 2681.146651 * 0.55, 4);
    expect(v.rows.map((r) => r.symbol)).toEqual(["weETH", "USDC"]); // largest first
  });
  it("prices native ETH like WETH (55% LTV)", () => {
    const v = valueHoldings([{ symbol: "ETH", address: "native", decimals: 18, rawBalance: 10n ** 18n, price6: 2_428_000_000n }]);
    expect(v.borrowPowerUsd).toBeCloseTo(2428 * 0.55, 6);
  });
  it("ignores empty balances and unpriced tokens; an empty wallet is zero", () => {
    const v = valueHoldings([
      { symbol: "USDC", address: USDC, decimals: 6, rawBalance: 0n, price6: 1_000_000n },
      { symbol: "OP", address: "0x4200000000000000000000000000000000000042", decimals: 18, rawBalance: 10n ** 18n, price6: 0n },
    ]);
    expect(v).toEqual({ rows: [], totalUsd: 0, borrowPowerUsd: 0 });
  });
});
