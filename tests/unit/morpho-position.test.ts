import { describe, expect, it } from "vitest";
import { assetsToShares, checkMorphoRequest, morphoLimits, morphoPosition, sharesToAssets, toPoolEvents, virtualShares, type VaultEvent } from "../../src/lib/morpho/position";

const SAFE = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const dep = (assets: bigint, owner = SAFE): VaultEvent => ({ kind: "deposit", assets, counterparty: owner });
const wd = (assets: bigint, receiver: string): VaultEvent => ({ kind: "withdraw", assets, counterparty: receiver });

describe("ERC-4626 share math (6-decimal asset, 18-decimal shares)", () => {
  // Real values read from the live Steakhouse USDG vault at one block on 2026-10-23, and the vault's own answers.
  const TA = 543_068_385_979_196n;
  const TS = 536_990_210_008_617_054_792_946_303n;
  it("virtual shares offset is 10^(18 - assetDecimals)", () => {
    expect(virtualShares(6)).toBe(10n ** 12n);
    expect(virtualShares(18)).toBe(1n);
  });
  it("matches the live vault's convertToAssets exactly", () => {
    expect(sharesToAssets(10n ** 18n, TA, TS)).toBe(1_011_318n);
    expect(sharesToAssets(123_456_789_012_345_678_901n, TA, TS)).toBe(124_854_192n);
    expect(sharesToAssets(10n ** 24n, TA, TS)).toBe(1_011_318_969_801n);
  });
  it("matches the live vault's convertToShares exactly", () => {
    expect(assetsToShares(1_000_000_000n, TA, TS)).toBe(988_807_715_331_063_704_553n);
  });
  it("zero and dust: nothing in, nothing out; one share is worth less than one base unit", () => {
    expect(sharesToAssets(0n, TA, TS)).toBe(0n);
    expect(assetsToShares(0n, TA, TS)).toBe(0n);
    expect(sharesToAssets(1n, TA, TS)).toBe(0n);
    expect(sharesToAssets(10n ** 12n, TA, TS)).toBe(1n);
  });
  it("rounds down, so a round trip never creates value", () => {
    for (const a of [1n, 7n, 999_999n, 1_000_000n, 123_456_789n, 10n ** 12n]) {
      expect(sharesToAssets(assetsToShares(a, TA, TS), TA, TS) <= a).toBe(true);
    }
  });
  it("max value does not overflow (bigint)", () => {
    expect(sharesToAssets(2n ** 200n, TA, TS) > 0n).toBe(true);
  });
  it("an empty vault is 1:1 per virtual share", () => {
    expect(sharesToAssets(10n ** 18n, 0n, 0n)).toBe(10n ** 18n / 10n ** 12n);
  });
});

describe("principal and yield from vault events", () => {
  it("principal = deposits for the Safe; yield = assets - principal", () => {
    const p = morphoPosition([dep(1_000_000_000n)], SAFE, 1_012_000_000n);
    expect(p).toEqual({ principal: 1_000_000_000n, aBalance: 1_012_000_000n, yieldAvailable: 12_000_000n });
  });
  it("a withdrawal to the Safe is a yield move, so principal is unchanged", () => {
    const p = morphoPosition([dep(1_000_000_000n), wd(5_000_000n, SAFE)], SAFE, 1_007_000_000n);
    expect(p.principal).toBe(1_000_000_000n);
    expect(p.yieldAvailable).toBe(7_000_000n);
  });
  it("a withdrawal to anyone else is a principal exit (case-insensitive recipient)", () => {
    const p = morphoPosition([dep(1_000_000_000n), wd(100_000_000n, OTHER)], SAFE, 912_000_000n);
    expect(p.principal).toBe(900_000_000n);
    expect(p.yieldAvailable).toBe(12_000_000n);
    expect(morphoPosition([dep(10n), wd(4n, SAFE.toUpperCase().replace("0X", "0x"))], SAFE, 10n).principal).toBe(10n);
  });
  it("a falling share price never shows negative yield", () => {
    const p = morphoPosition([dep(1_000_000_000n)], SAFE, 990_000_000n);
    expect(p.yieldAvailable).toBe(0n);
    expect(p.principal).toBe(1_000_000_000n);
  });
  it("no events and no shares is an empty position", () => {
    expect(morphoPosition([], SAFE, 0n)).toEqual({ principal: 0n, aBalance: 0n, yieldAvailable: 0n });
  });
  it("maps deposit/withdraw onto the shared event kinds", () => {
    expect(toPoolEvents([dep(5n), wd(2n, OTHER)]).map((e) => e.kind)).toEqual(["supply", "withdraw"]);
  });
});

describe("dual-source validation (VaultV2 max* functions return 0, so liquidity is checked by simulation)", () => {
  const p = { principal: 1_000_000_000n, aBalance: 1_012_000_000n, yieldAvailable: 12_000_000n };
  it("yield limit leaves a 1-unit rounding margin; principal limit is the deposit", () => {
    expect(morphoLimits(p)).toEqual({ yield: 11_999_999n, principal: 1_000_000_000n });
  });
  it("blocks zero, over-yield and over-principal; allows exact limits and dust", () => {
    expect(checkMorphoRequest("yield", 0n, p).ok).toBe(false);
    expect(checkMorphoRequest("yield", -1n, p).ok).toBe(false);
    expect(checkMorphoRequest("yield", 12_000_000n, p)).toEqual({ ok: false, reason: "That is more than the yield you have earned. Your principal stays locked." });
    expect(checkMorphoRequest("yield", 11_999_999n, p).ok).toBe(true);
    expect(checkMorphoRequest("yield", 1n, p).ok).toBe(true);
    expect(checkMorphoRequest("principal", 1_000_000_001n, p)).toEqual({ ok: false, reason: "That is more than your deposited principal." });
    expect(checkMorphoRequest("principal", 1_000_000_000n, p).ok).toBe(true);
  });
  it("principal can never exceed what the position actually holds", () => {
    expect(morphoLimits({ principal: 1_000n, aBalance: 900n, yieldAvailable: 0n }).principal).toBe(900n);
  });
  it("no yield means no yield spend", () => {
    expect(morphoLimits({ principal: 100n, aBalance: 100n, yieldAvailable: 0n }).yield).toBe(0n);
    expect(checkMorphoRequest("yield", 1n, { principal: 100n, aBalance: 100n, yieldAvailable: 0n }).ok).toBe(false);
  });
});
