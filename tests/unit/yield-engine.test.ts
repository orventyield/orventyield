import { describe, expect, it } from "vitest";
import { ENGINE_BY_CHAIN, engineAsset, isEngineChain, resolveEngine } from "../../src/lib/yieldEngine";

describe("network-aware engine routing", () => {
  it("42161 -> Aave, 4663 -> Morpho", () => {
    expect(resolveEngine(42161)).toEqual({ engine: "aave", chainId: 42161 });
    expect(resolveEngine(4663)).toEqual({ engine: "morpho", chainId: 4663 });
  });
  it("any other network (bridging from Base, Ethereum, ...) or none keeps the default, Arbitrum One / Aave", () => {
    for (const c of [8453, 1, 10, 137, 31337, 0, undefined]) expect(resolveEngine(c)).toEqual({ engine: "aave", chainId: 42161 });
  });
  it("only the two engine chains are engine chains", () => {
    expect(Object.keys(ENGINE_BY_CHAIN).map(Number).sort((a, b) => a - b)).toEqual([4663, 42161]);
    expect(isEngineChain(4663)).toBe(true);
    expect(isEngineChain(8453)).toBe(false);
    expect(isEngineChain(undefined)).toBe(false);
  });
  it("spending rails (vouchers, card, bank / UPI) are Arbitrum USDC only; Robinhood holds USDG yield", () => {
    expect(engineAsset("aave")).toEqual({ symbol: "USDC", spendingRails: true });
    expect(engineAsset("morpho")).toEqual({ symbol: "USDG", spendingRails: false });
  });
});
