import { describe, expect, it } from "vitest";
import { ARBITRUM } from "../../src/lib/contracts/arbitrum";
import { assertArbitrumTarget, chunked } from "../../src/lib/aave/account";
import { morphoPosition } from "../../src/lib/morpho/position";

describe("assertArbitrumTarget: security allowlist enforcement", () => {
  const SAFE = "0x1111111111111111111111111111111111111111";

  it("permits the canonical Arbitrum Safe proxy factory", () => {
    expect(() => assertArbitrumTarget(ARBITRUM.safeProxyFactory, SAFE)).not.toThrow();
  });

  it("permits the Arbitrum USDC token", () => {
    expect(() => assertArbitrumTarget(ARBITRUM.usdc, SAFE)).not.toThrow();
  });

  it("permits the Arbitrum Aave v3 pool", () => {
    expect(() => assertArbitrumTarget(ARBITRUM.aavePool, SAFE)).not.toThrow();
  });

  it("permits calls to the user's own Safe", () => {
    expect(() => assertArbitrumTarget(SAFE, SAFE)).not.toThrow();
  });

  it("strictly blocks unapproved third-party contracts", () => {
    expect(() => assertArbitrumTarget("0x9999999999999999999999999999999999999999", SAFE)).toThrow(
      "Blocked: that contract is not one OrventYield may call.",
    );
  });
});

describe("adaptiveFetch in chunked: recovers from RPC range/limit errors", () => {
  it("subdivides dynamically when provider rejects large block span", async () => {
    let callCount = 0;
    // Mock RPC that rejects any block range larger than 5,000 blocks
    const mockFetcher = async (a: bigint, b: bigint) => {
      callCount++;
      if (b - a > 5_000n) {
        throw new Error("RPC error: query returned more than 10000 results or block range exceeds limit");
      }
      return [{ block: a }];
    };

    const logs = await chunked(0n, 10_000n, mockFetcher);
    expect(callCount).toBeGreaterThan(1); // successfully subdivided
    expect(logs.length).toBeGreaterThan(0);
  });

  it("returns empty array safely when from > to", async () => {
    const logs = await chunked(100n, 50n, async () => [{ block: 1n }]);
    expect(logs).toEqual([]);
  });
});

describe("morphoPosition invariant defense: zero events with positive assets", () => {
  it("treats positive balance as principal (never 100% false yield) if event logs are temporarily empty", () => {
    const safe = "0x1111111111111111111111111111111111111111";
    const assets = 5_000_000_000n; // 5,000 USDG
    const pos = morphoPosition([], safe, assets);

    expect(pos.principal).toBe(assets);
    expect(pos.yieldAvailable).toBe(0n);
    expect(pos.aBalance).toBe(assets);
  });
});
