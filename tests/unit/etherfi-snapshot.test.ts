import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { availableLimit, authorizeCardSpend, healthFactor } from "../../src/utils/engine";
import { liveToAccount, parseSafeCashData, type RawSafeCashData } from "../../src/lib/etherfi/snapshot";

// Real responses captured from Optimism (CashLens.getSafeCashData + DebtManager.getMaxBorrowAmount(safe, false)).
interface Fixture {
  block: string;
  safes: { safe: `0x${string}`; raw: RawSafeCashData; liqMaxBorrow: bigint }[];
}
const revive = (_: string, v: unknown) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const fx: Fixture = JSON.parse(readFileSync(new URL("../fixtures/safe-cash-data.json", import.meta.url), "utf8"), revive);
const parsed = fx.safes.map((s) => ({ ...s, live: parseSafeCashData(s.safe, s.raw, s.liqMaxBorrow) }));

describe("parseSafeCashData (real Optimism Safes)", () => {
  it("captured a useful spread: empty, debit-mode, and credit-mode with debt", () => {
    expect(fx.safes.length).toBeGreaterThanOrEqual(6);
    expect(parsed.some((p) => p.live.totalCollateralUsd === 0)).toBe(true);
    expect(parsed.some((p) => p.live.mode === "debit")).toBe(true);
    expect(parsed.some((p) => p.live.mode === "credit" && p.live.totalBorrowUsd > 0)).toBe(true);
  });

  it.each(parsed.map((p) => [p.safe, p] as const))("%s: token values add up to the contract's totalCollateral", (_, p) => {
    const sum = p.live.collateral.reduce((a, t) => a + t.valueUsd, 0);
    expect(p.live.collateral.every((t) => t.known)).toBe(true); // every collateral token is in the registry
    expect(Math.abs(sum - p.live.totalCollateralUsd)).toBeLessThanOrEqual(Math.max(0.05, p.live.totalCollateralUsd * 0.005));
  });

  it.each(parsed.map((p) => [p.safe, p] as const))("%s: borrow ceilings are sane (maxBorrow <= collateral, debt <= liquidation ceiling)", (_, p) => {
    expect(p.live.maxBorrowUsd).toBeLessThanOrEqual(p.live.totalCollateralUsd + 0.01);
    expect(p.live.liqMaxBorrowUsd).toBeLessThanOrEqual(p.live.totalCollateralUsd + 0.01);
    if (p.live.totalBorrowUsd > 0) expect(p.live.totalBorrowUsd).toBeLessThanOrEqual(p.live.liqMaxBorrowUsd * 1.0001);
  });

  it.each(parsed.map((p) => [p.safe, p] as const))("%s: health factor is liqMaxBorrow / totalBorrow", (_, p) => {
    if (p.live.totalBorrowUsd === 0) expect(p.live.healthFactor).toBe(Infinity);
    else expect(p.live.healthFactor).toBeCloseTo(p.live.liqMaxBorrowUsd / p.live.totalBorrowUsd, 10);
  });

  it("maps mode 0 to credit and mode 1 to debit", () => {
    for (const p of parsed) expect(p.live.mode).toBe(p.raw.mode === 0 ? "credit" : "debit");
  });

  it("credit capacity never exceeds the plain borrow headroom (extra lend-gateway limits only reduce it)", () => {
    for (const p of parsed.filter((x) => x.live.mode === "credit")) {
      const headroom = Math.max(0, p.live.maxBorrowUsd - p.live.totalBorrowUsd);
      expect(p.live.creditMaxSpendUsd).toBeLessThanOrEqual(headroom + 0.01);
    }
  });
});

describe("liveToAccount feeds the spend engine", () => {
  const local = { frozen: false, monthlyLimitUsd: 1_000_000, spentThisMonthUsd: 0 };

  it.each(parsed.filter((p) => p.live.mode === "credit").map((p) => [p.safe, p] as const))("%s: engine credit limit equals the contract's creditMaxSpend", (_, p) => {
    const acct = liveToAccount(p.live, local);
    expect(availableLimit(acct)).toBeCloseTo(p.live.creditMaxSpendUsd, 4);
    expect(acct.advanceUsd).toBe(0);
    expect(acct.yieldUsd).toBe(0); // yield/micro-buffer are not on-chain concepts
  });

  it.each(parsed.filter((p) => p.live.mode === "debit").map((p) => [p.safe, p] as const))("%s: debit mode spends balances with no debt", (_, p) => {
    const acct = liveToAccount(p.live, local);
    expect(acct.maxLtv).toBe(0);
    expect(acct.yieldUsd).toBeCloseTo(p.live.debitMaxSpendUsd, 6);
    if (p.live.debitMaxSpendUsd > 1) {
      const ok = authorizeCardSpend(acct, p.live.debitMaxSpendUsd / 2);
      expect(ok.ok).toBe(true);
      if (ok.ok) expect(ok.funding.fromCredit).toBe(0);
      expect(authorizeCardSpend(acct, p.live.debitMaxSpendUsd * 2).ok).toBe(false);
    }
  });

  it("the Safe's remaining spending-limit allowance caps a spend", () => {
    const p = parsed.find((x) => x.live.mode === "credit" && x.live.creditMaxSpendUsd > 100 && x.live.spendingLimitAllowanceUsd < x.live.creditMaxSpendUsd)!;
    const acct = liveToAccount(p.live, local);
    expect(authorizeCardSpend(acct, p.live.spendingLimitAllowanceUsd * 0.9).ok).toBe(true);
    const over = authorizeCardSpend(acct, p.live.spendingLimitAllowanceUsd + 1);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("MONTHLY_LIMIT");
  });

  it("engine health factor equals the contract-derived one", () => {
    for (const p of parsed.filter((x) => x.live.totalBorrowUsd > 0 && x.live.totalCollateralUsd > 0)) {
      const a = liveToAccount(p.live, local);
      expect(healthFactor(a.collateralUsd, a.liqThreshold, a.debtUsd)).toBeCloseTo(p.live.healthFactor, 8);
    }
  });

  it("a $1 swipe is approved for a healthy credit Safe and declined for one below the 1.20x floor", () => {
    const healthy = parsed.find((p) => p.live.mode === "credit" && p.live.healthFactor > 1.5 && p.live.creditMaxSpendUsd > 1)!;
    expect(authorizeCardSpend(liveToAccount(healthy.live, local), 1).ok).toBe(true);
    const risky = parsed.find((p) => p.live.totalBorrowUsd > 0 && p.live.healthFactor < 1.2);
    if (risky) {
      const d = authorizeCardSpend(liveToAccount(risky.live, local), 1);
      expect(d.ok).toBe(false);
    }
  });

  it("local freeze applies to live accounts too", () => {
    const p = parsed.find((x) => x.live.creditMaxSpendUsd > 1)!;
    const d = authorizeCardSpend(liveToAccount(p.live, { ...local, frozen: true }), 1);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toBe("CARD FROZEN");
  });
});
