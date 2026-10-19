import { describe, expect, it } from "vitest";
import { RAY, maxPrincipalWithdrawal, maxYieldWithdrawal, netPrincipal, positionOf, rayToApy, yieldPerSecond, type PoolEvent } from "../../src/lib/aave/position";

const SAFE = "0xAbCdEf0000000000000000000000000000000001";
const OWNER = "0x00000000000000000000000000000000000000aa";
const sup = (amount: bigint, to = SAFE): PoolEvent => ({ kind: "supply", amount, counterparty: to });
const wd = (amount: bigint, to: string): PoolEvent => ({ kind: "withdraw", amount, counterparty: to });
const USDC = (n: number) => BigInt(Math.round(n * 1e6));

describe("principal and yield", () => {
  it("is zero with no events (zero case)", () => {
    expect(netPrincipal([], SAFE)).toBe(0n);
    expect(positionOf([], SAFE, 0n)).toEqual({ principal: 0n, aBalance: 0n, yieldAvailable: 0n });
  });

  it("sums supplies made on behalf of the Safe and ignores other beneficiaries", () => {
    expect(netPrincipal([sup(USDC(100)), sup(USDC(50)), sup(USDC(999), OWNER)], SAFE)).toBe(USDC(150));
  });

  it("yield = balance - principal, and yield withdrawals (to the Safe) do not touch principal", () => {
    const events = [sup(USDC(1000)), wd(USDC(1.9), SAFE)];
    const p = positionOf(events, SAFE.toLowerCase(), USDC(1000.01)); // 1000 + 1.91 earned - 1.9 withdrawn
    expect(p.principal).toBe(USDC(1000));
    expect(p.yieldAvailable).toBe(USDC(0.01));
  });

  it("a withdrawal to the owner is a principal exit", () => {
    const p = positionOf([sup(USDC(1000)), wd(USDC(400), OWNER)], SAFE, USDC(600.5));
    expect(p.principal).toBe(USDC(600));
    expect(p.yieldAvailable).toBe(USDC(0.5));
  });

  it("never reports negative principal or yield (dust, over-withdrawal, rounding)", () => {
    expect(netPrincipal([sup(1n), wd(10n, OWNER)], SAFE)).toBe(0n);
    const p = positionOf([sup(USDC(10))], SAFE, USDC(10) - 1n); // Aave rounding can leave the balance 1 unit short
    expect(p.principal).toBe(USDC(10)); // shown exactly as deposited
    expect(p.yieldAvailable).toBe(0n);
    expect(maxPrincipalWithdrawal(p)).toBe(USDC(10) - 1n); // but never ask Aave for more than it holds
    expect(maxPrincipalWithdrawal({ principal: 5n, aBalance: 9n, yieldAvailable: 4n })).toBe(5n);
  });

  it("handles max-size amounts without overflow (bigint)", () => {
    const big = 2n ** 200n;
    expect(positionOf([sup(big)], SAFE, big + 5n).yieldAvailable).toBe(5n);
  });

  it("maxYieldWithdrawal leaves a rounding margin and is zero for dust", () => {
    expect(maxYieldWithdrawal({ principal: 0n, aBalance: 100n, yieldAvailable: 100n })).toBe(99n);
    expect(maxYieldWithdrawal({ principal: 0n, aBalance: 1n, yieldAvailable: 1n })).toBe(0n);
    expect(maxYieldWithdrawal({ principal: 0n, aBalance: 0n, yieldAvailable: 0n })).toBe(0n);
  });
});

describe("rates", () => {
  it("zero rate means zero APY", () => {
    expect(rayToApy(0n)).toBe(0);
    expect(rayToApy(-1n)).toBe(0);
  });
  it("compounds the ray APR into APY (5% APR -> ~5.127%)", () => {
    expect(rayToApy(RAY / 20n)).toBeCloseTo(0.05127, 4);
  });
  it("yield per second matches APR / year", () => {
    const perYear = yieldPerSecond(1_000_000_000n, RAY / 20n) * 31_536_000; // 1000 USDC at 5%
    expect(perYear / 1e6).toBeCloseTo(50, 6);
  });
});
