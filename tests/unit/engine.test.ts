import { describe, it, expect } from "vitest";
import {
  MIN_HEALTH_FACTOR,
  accrueYield,
  advanceRoom,
  authorizeCardSpend,
  availableLimit,
  cashOut,
  healthFactor,
  issueCard,
  microBuffer,
  purchaseVoucher,
  repayDebtWithYield,
  type AccountState,
} from "../../src/utils/engine";

const base = (over: Partial<AccountState> = {}): AccountState => ({
  collateralUsd: 1000,
  maxLtv: 0.75,
  liqThreshold: 0.75,
  cardActive: true,
  apyPercent: 0,
  debtUsd: 0,
  advanceUsd: 0,
  yieldUsd: 0,
  frozen: false,
  monthlyLimitUsd: 100_000,
  spentThisMonthUsd: 0,
  ...over,
});

describe("one user = one card (engine)", () => {
  const empty = { byPhone: {}, byOwner: {} };

  it("a swipe on a card that is not activated is declined, before any other check", () => {
    const d = authorizeCardSpend(base({ cardActive: false, frozen: true, yieldUsd: 500 }), 4.85);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("CARD_NOT_ACTIVE");
      expect(d.message).toBe("CARD NOT ACTIVATED");
    }
  });

  it("activating makes the card usable", () => {
    const s = base({ cardActive: false, yieldUsd: 50 });
    expect(authorizeCardSpend(s, 5).ok).toBe(false);
    expect(authorizeCardSpend({ ...s, cardActive: true }, 5).ok).toBe(true);
  });

  it("issueCard creates exactly one card per verified identity", () => {
    const first = issueCard(empty, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "id-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = issueCard(first.registry, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "id-1");
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.code).toBe("PHONE_ALREADY_BOUND");
      expect(dup.message).toBe("Card already active for this verified identity.");
    }
  });

  it("issueCard rejects a second identity for the same owner and is idempotent for the same pair", () => {
    const first = issueCard(empty, "guest:alice", "id-1");
    if (!first.ok) throw new Error("setup");
    const second = issueCard(first.registry, "guest:alice", "id-2");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("OWNER_ALREADY_HAS_CARD");
    expect(issueCard(first.registry, "guest:alice", "id-1")).toMatchObject({ ok: true, idempotent: true });
  });
});

describe("authorizeCardSpend", () => {
  it("declines everything with CARD FROZEN when frozen, even with plenty of funds", () => {
    const s = base({ frozen: true, yieldUsd: 500 });
    const d = authorizeCardSpend(s, 4.85);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("CARD_FROZEN");
      expect(d.message).toBe("CARD FROZEN");
      expect(d.next).toBe(s);
    }
  });

  it.each([0, -5, NaN, Infinity])("rejects invalid amount %s", (amt) => {
    const d = authorizeCardSpend(base({ yieldUsd: 100 }), amt);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("INVALID_AMOUNT");
  });

  it("enforces the monthly spend limit", () => {
    const s = base({ yieldUsd: 1000, monthlyLimitUsd: 200, spentThisMonthUsd: 190 });
    const d = authorizeCardSpend(s, 16.5);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("MONTHLY_LIMIT");
    expect(authorizeCardSpend(s, 10).ok).toBe(true);
  });

  it("funds from settled yield first: no debt, HF and collateral unchanged", () => {
    const s = base({ yieldUsd: 48.25, debtUsd: 100 });
    const d = authorizeCardSpend(s, 19.99);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.funding).toEqual({ fromYield: 19.99, fromAdvance: 0, fromCredit: 0 });
      expect(d.next.debtUsd).toBe(100);
      expect(d.next.collateralUsd).toBe(1000);
      expect(d.next.yieldUsd).toBeCloseTo(28.26, 6);
      expect(d.healthAfter).toBe(d.healthBefore);
    }
  });

  it("uses the 7-day micro-buffer as a collateral-free advance when yield runs short", () => {
    // 10,000 @ 10% APY -> 7-day buffer = 10000 * 0.1/365 * 7 = 19.18
    const s = base({ collateralUsd: 10_000, apyPercent: 10, yieldUsd: 2 });
    expect(microBuffer(s)).toBeCloseTo(19.18, 2);
    const d = authorizeCardSpend(s, 16.5);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.funding.fromYield).toBe(2);
      expect(d.funding.fromAdvance).toBeCloseTo(14.5, 6);
      expect(d.funding.fromCredit).toBe(0);
      expect(d.next.debtUsd).toBe(0); // advance is not collateral-backed debt
      expect(d.next.advanceUsd).toBeCloseTo(14.5, 6);
      expect(d.next.yieldUsd).toBe(0);
    }
  });

  it("never lets outstanding advance exceed the buffer", () => {
    let s = base({ collateralUsd: 10_000, apyPercent: 10, yieldUsd: 0 });
    for (let i = 0; i < 5; i++) {
      const d = authorizeCardSpend(s, 10);
      if (d.ok) s = d.next;
      expect(s.advanceUsd).toBeLessThanOrEqual(microBuffer(s) + 1e-9);
    }
  });

  it("draws credit against collateral once yield and buffer are exhausted", () => {
    const s = base({ yieldUsd: 0 }); // zero APY -> zero buffer
    const d = authorizeCardSpend(s, 149);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.funding).toEqual({ fromYield: 0, fromAdvance: 0, fromCredit: 149 });
      expect(d.next.debtUsd).toBe(149);
    }
  });

  it("allows a draw that lands exactly on HF 1.20x and declines one cent over", () => {
    // collateral 1000 * 0.75 = 750 max borrow; HF >= 1.2  <=>  debt <= 625
    expect(authorizeCardSpend(base(), 625).ok).toBe(true);
    const d = authorizeCardSpend(base(), 625.01);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("HEALTH_FACTOR");
  });

  it("gates on the unrounded health factor (1.1999x must not pass as 1.20x)", () => {
    const hf = healthFactor(1000, 0.75, 625.05);
    expect(hf).toBeLessThan(MIN_HEALTH_FACTOR);
    expect(hf.toFixed(2)).toBe("1.20"); // what a rounded display would show
    const d = authorizeCardSpend(base(), 625.05);
    expect(d.ok).toBe(false);
  });

  it("declines INSUFFICIENT_LIMIT when the draw exceeds the available limit", () => {
    const s = base({ debtUsd: 100 });
    expect(availableLimit(s)).toBe(650);
    const d = authorizeCardSpend(s, 700);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("INSUFFICIENT_LIMIT");
  });

  it("declines if the position is already below the HF floor, even for a yield-funded spend", () => {
    const s = base({ debtUsd: 700, yieldUsd: 50 }); // HF = 750/700 = 1.07
    const d = authorizeCardSpend(s, 5);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("HEALTH_FACTOR");
  });

  it("never mutates the input state", () => {
    const s = base({ yieldUsd: 50 });
    const snapshot = JSON.stringify(s);
    authorizeCardSpend(s, 10);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("Ether.fi risk model: LTV sets the borrow limit, liquidation threshold sets the health factor", () => {
  // weETH on Ether.fi Cash: LTV 55%, liquidation threshold 75%.
  const weeth = (over: Partial<AccountState> = {}) => base({ maxLtv: 0.55, liqThreshold: 0.75, ...over });

  it("borrow limit uses LTV: 1000 of weETH can borrow 550, not 750", () => {
    expect(availableLimit(weeth())).toBe(550);
    expect(authorizeCardSpend(weeth(), 550).ok).toBe(true);
    const d = authorizeCardSpend(weeth(), 551);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("INSUFFICIENT_LIMIT");
  });

  it("health factor uses the liquidation threshold: debt 550 gives 750/550 = 1.36x", () => {
    const d = authorizeCardSpend(weeth(), 550);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.healthAfter).toBeCloseTo(750 / 550, 10);
  });

  // USDC on Ether.fi Cash: LTV 90%, liquidation threshold 95%. Here the 1.20x floor binds before the LTV cap.
  const usdc = (over: Partial<AccountState> = {}) => base({ maxLtv: 0.9, liqThreshold: 0.95, ...over });

  it("for stable collateral the 1.20x floor binds before the LTV cap", () => {
    // HF >= 1.2  <=>  debt <= 950 / 1.2 = 791.67 (while LTV would allow 900)
    expect(authorizeCardSpend(usdc(), 791).ok).toBe(true);
    const d = authorizeCardSpend(usdc(), 792);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("HEALTH_FACTOR");
  });

  it("blended positions sit between the two assets", () => {
    // 500 weETH-like + 500 USDC-like: ltv = (500*.55 + 500*.9)/1000 = .725, liq = .85
    const mixed = base({ maxLtv: 0.725, liqThreshold: 0.85 });
    expect(availableLimit(mixed)).toBe(725);
  });
});

describe("accrueYield", () => {
  it("repays an outstanding advance before adding to spendable yield", () => {
    const s = base({ advanceUsd: 5, yieldUsd: 0 });
    const a = accrueYield(s, 3);
    expect(a.advanceUsd).toBe(2);
    expect(a.yieldUsd).toBe(0);
    const b = accrueYield(a, 4);
    expect(b.advanceUsd).toBe(0);
    expect(b.yieldUsd).toBe(2);
  });

  it("ignores non-positive deltas", () => {
    const s = base({ yieldUsd: 1 });
    expect(accrueYield(s, 0)).toBe(s);
    expect(accrueYield(s, -1)).toBe(s);
  });

  it("advance room shrinks as advances are taken and recovers as they are repaid", () => {
    const s = base({ collateralUsd: 10_000, apyPercent: 10, advanceUsd: 10 });
    expect(advanceRoom(s)).toBeCloseTo(microBuffer(s) - 10, 6);
    expect(advanceRoom(accrueYield(s, 10))).toBeCloseTo(microBuffer(s), 6);
  });
});

describe("repayDebtWithYield (Auto-Pilot)", () => {
  it("sweeps yield into debt, improves HF, leaves principal alone", () => {
    const s = base({ debtUsd: 400, yieldUsd: 150 });
    const r = repayDebtWithYield(s);
    expect(r.ok).toBe(true);
    expect(r.repaidUsd).toBe(150);
    expect(r.next.debtUsd).toBe(250);
    expect(r.next.yieldUsd).toBe(0);
    expect(r.next.collateralUsd).toBe(1000);
    expect(r.healthAfter).toBeGreaterThan(r.healthBefore);
  });

  it("repays at most the outstanding debt", () => {
    const r = repayDebtWithYield(base({ debtUsd: 10, yieldUsd: 150 }));
    expect(r.repaidUsd).toBe(10);
    expect(r.next.yieldUsd).toBe(140);
    expect(r.next.debtUsd).toBe(0);
  });

  it("is a no-op with no debt or no yield", () => {
    expect(repayDebtWithYield(base({ debtUsd: 0, yieldUsd: 50 })).ok).toBe(false);
    expect(repayDebtWithYield(base({ debtUsd: 50, yieldUsd: 0 })).ok).toBe(false);
  });

  it("brings a risky position back to Safe (> 1.5x)", () => {
    const s = base({ debtUsd: 600, yieldUsd: 200 }); // HF 1.25
    expect(healthFactor(s.collateralUsd, s.maxLtv, s.debtUsd)).toBeLessThan(1.5);
    const r = repayDebtWithYield(s);
    expect(r.healthAfter).toBeGreaterThan(1.5);
  });
});

describe("purchaseVoucher", () => {
  it("yield funding is free: $0 debt, collateral untouched", () => {
    const s = base({ yieldUsd: 48.25, debtUsd: 350 });
    const d = purchaseVoucher(s, 25, "yield");
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.next.debtUsd).toBe(350);
      expect(d.next.collateralUsd).toBe(1000);
      expect(d.next.yieldUsd).toBeCloseTo(23.25, 6);
      expect(d.funding).toEqual({ fromYield: 25, fromAdvance: 0, fromCredit: 0 });
    }
  });

  it("yield funding never borrows: declines INSUFFICIENT_YIELD instead", () => {
    const d = purchaseVoucher(base({ yieldUsd: 10, apyPercent: 10, collateralUsd: 10_000 }), 25, "yield");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("INSUFFICIENT_YIELD");
  });

  it("credit funding borrows against collateral and respects the HF floor", () => {
    const ok = purchaseVoucher(base(), 50, "credit");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.next.debtUsd).toBe(50);
    const bad = purchaseVoucher(base(), 700, "credit");
    expect(bad.ok).toBe(false);
  });
});

describe("cashOut", () => {
  it("pays from yield first and never touches credit when yield suffices", () => {
    const d = cashOut(base({ yieldUsd: 80 }), 50, false);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.funding).toEqual({ fromYield: 50, fromAdvance: 0, fromCredit: 0 });
      expect(d.next.debtUsd).toBe(0);
    }
  });

  it("declines a shortfall unless the user opts into a credit advance", () => {
    const s = base({ yieldUsd: 20 });
    const no = cashOut(s, 50, false);
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.code).toBe("INSUFFICIENT_YIELD");
    const yes = cashOut(s, 50, true);
    expect(yes.ok).toBe(true);
    if (yes.ok) {
      expect(yes.funding).toEqual({ fromYield: 20, fromAdvance: 0, fromCredit: 30 });
      expect(yes.next.debtUsd).toBe(30);
      expect(yes.next.yieldUsd).toBe(0);
    }
  });
});

describe("invariants under random operation sequences", () => {
  // Small seeded PRNG so failures are reproducible.
  function rng(seed: number) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  it.each([1, 2, 3, 42, 2026])("seed %i: principal is never eroded and HF floor always holds", (seed) => {
    const rand = rng(seed);
    let s = base({ collateralUsd: 6900, apyPercent: 8.4, yieldUsd: 48.25, debtUsd: 350, monthlyLimitUsd: 1_000_000 });
    const principal = s.collateralUsd;

    for (let i = 0; i < 2000; i++) {
      const op = Math.floor(rand() * 6);
      const amt = Math.round(rand() * 400 * 100) / 100;
      const before = s;
      if (op === 0) {
        const d = authorizeCardSpend(s, amt);
        if (d.ok) {
          expect(d.healthAfter).toBeGreaterThanOrEqual(MIN_HEALTH_FACTOR);
          const f = d.funding;
          expect(f.fromYield + f.fromAdvance + f.fromCredit).toBeCloseTo(amt, 5);
          s = d.next;
        } else expect(d.next).toBe(before);
      } else if (op === 1) {
        const d = purchaseVoucher(s, amt, rand() > 0.5 ? "yield" : "credit");
        if (d.ok) {
          expect(d.healthAfter).toBeGreaterThanOrEqual(MIN_HEALTH_FACTOR);
          s = d.next;
        }
      } else if (op === 2) {
        const d = cashOut(s, amt, rand() > 0.5);
        if (d.ok) {
          expect(d.healthAfter).toBeGreaterThanOrEqual(MIN_HEALTH_FACTOR);
          s = d.next;
        }
      } else if (op === 3) {
        s = repayDebtWithYield(s).next;
      } else if (op === 4) {
        s = accrueYield(s, rand() * 3);
      } else {
        s = { ...s, frozen: rand() > 0.7 };
      }

      expect(s.collateralUsd).toBe(principal);
      expect(s.debtUsd).toBeGreaterThanOrEqual(0);
      expect(s.yieldUsd).toBeGreaterThanOrEqual(0);
      expect(s.advanceUsd).toBeGreaterThanOrEqual(0);
      expect(s.advanceUsd).toBeLessThanOrEqual(microBuffer(s) + 1e-6);
      expect(s.debtUsd).toBeLessThanOrEqual(availableLimit({ ...s, debtUsd: 0 }) + 1e-6);
    }
  });
});

describe("latency", () => {
  it("a decision takes well under the 300 ms card-rail budget", () => {
    const s = base({ collateralUsd: 6900, apyPercent: 8.4, yieldUsd: 48.25, debtUsd: 350 });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) authorizeCardSpend(s, 4.85);
    expect((performance.now() - t0) / 1000).toBeLessThan(300);
  });
});
