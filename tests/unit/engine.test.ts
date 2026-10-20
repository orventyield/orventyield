import { describe, it, expect } from "vitest";
import {
  accrueYield,
  authorizeCardSpend,
  cashOut,
  checkWithdrawPrincipal,
  issueCard,
  purchaseVoucher,
  spendable,
  yieldOver,
  type AccountState,
} from "../../src/utils/engine";

const base = (over: Partial<AccountState> = {}): AccountState => ({
  principalUsd: 1000,
  apyPercent: 4,
  cardActive: true,
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
    // a second wallet proving the same identity re-links the card to itself: still exactly one holder
    const relinked = issueCard(first.registry, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "id-1");
    expect(relinked.ok).toBe(true);
    if (relinked.ok) {
      expect(Object.keys(relinked.registry.byOwner)).toEqual(["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
      expect(Object.keys(relinked.registry.byPhone)).toEqual(["id-1"]);
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

describe("authorizeCardSpend: only earned yield can be spent", () => {
  it("approves a swipe within earned yield and takes exactly that from yield, never from principal", () => {
    const s = base({ yieldUsd: 48.25 });
    const d = authorizeCardSpend(s, 4.85);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.funding).toEqual({ fromYield: 4.85 });
    expect(d.next.yieldUsd).toBeCloseTo(43.4, 6);
    expect(d.next.principalUsd).toBe(1000);
    expect(d.next.spentThisMonthUsd).toBeCloseTo(4.85, 6);
  });

  it("declines EXCEEDS EARNED YIELD instead of borrowing or touching principal", () => {
    const s = base({ yieldUsd: 3 });
    const d = authorizeCardSpend(s, 4.85);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("INSUFFICIENT_YIELD");
      expect(d.message).toBe("EXCEEDS EARNED YIELD");
      expect(d.next).toBe(s); // nothing changed
    }
  });

  it("allows spending exactly all the yield and declines one cent more", () => {
    const s = base({ yieldUsd: 10 });
    const all = authorizeCardSpend(s, 10);
    expect(all.ok && all.next.yieldUsd).toBe(0);
    expect(authorizeCardSpend(s, 10.01).ok).toBe(false);
  });

  it("zero yield means nothing is spendable, however large the principal", () => {
    const s = base({ principalUsd: 1_000_000_000, yieldUsd: 0 });
    expect(spendable(s)).toBe(0);
    expect(authorizeCardSpend(s, 0.01).ok).toBe(false);
  });

  it("handles dust and very large amounts", () => {
    expect(authorizeCardSpend(base({ yieldUsd: 0.000001 }), 0.000001).ok).toBe(true);
    expect(authorizeCardSpend(base({ yieldUsd: 1e12, monthlyLimitUsd: 1e13 }), 1e12).ok).toBe(true);
  });

  it("rejects invalid amounts (zero, negative, NaN, Infinity)", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const d = authorizeCardSpend(base({ yieldUsd: 50 }), bad);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe("INVALID_AMOUNT");
    }
  });

  it("declines everything with CARD FROZEN when frozen, even with plenty of yield", () => {
    const d = authorizeCardSpend(base({ frozen: true, yieldUsd: 500 }), 1);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toBe("CARD FROZEN");
  });

  it("enforces the monthly spend limit across swipes", () => {
    let s = base({ yieldUsd: 500, monthlyLimitUsd: 100 });
    const a = authorizeCardSpend(s, 60);
    if (!a.ok) throw new Error("setup");
    s = a.next;
    const b = authorizeCardSpend(s, 41);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe("MONTHLY_LIMIT");
    expect(authorizeCardSpend(s, 40).ok).toBe(true);
  });

  it("never mutates the input state", () => {
    const s = base({ yieldUsd: 50 });
    const frozen = JSON.stringify(s);
    authorizeCardSpend(s, 5);
    authorizeCardSpend(s, 500);
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe("purchaseVoucher and cashOut use the same rule", () => {
  it("a voucher is paid from yield only", () => {
    const d = purchaseVoucher(base({ yieldUsd: 48.25 }), 25);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.funding).toEqual({ fromYield: 25 });
      expect(d.next.yieldUsd).toBeCloseTo(23.25, 6);
      expect(d.next.principalUsd).toBe(1000);
    }
  });
  it("a voucher larger than the yield is declined, not borrowed", () => {
    const d = purchaseVoucher(base({ yieldUsd: 10 }), 25);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("INSUFFICIENT_YIELD");
  });
  it("a cashout is paid from yield only and counts toward the monthly limit", () => {
    const ok = cashOut(base({ yieldUsd: 80, monthlyLimitUsd: 100 }), 50);
    expect(ok.ok && ok.next.spentThisMonthUsd).toBe(50);
    expect(cashOut(base({ yieldUsd: 30 }), 50).ok).toBe(false);
    expect(cashOut(base({ yieldUsd: 500, monthlyLimitUsd: 100 }), 101).ok).toBe(false);
  });
});

describe("yield accrual", () => {
  it("adds to spendable yield and ignores non-positive deltas", () => {
    expect(accrueYield(base({ yieldUsd: 1 }), 0.5).yieldUsd).toBeCloseTo(1.5, 6);
    for (const bad of [0, -2, NaN, Infinity]) expect(accrueYield(base({ yieldUsd: 1 }), bad).yieldUsd).toBe(1);
  });
  it("yieldOver is principal x APY x time, and zero without principal, APY or time", () => {
    expect(yieldOver({ principalUsd: 5000, apyPercent: 3.5 }, 31_536_000)).toBeCloseTo(175, 9);
    expect(yieldOver({ principalUsd: 0, apyPercent: 3.5 }, 100)).toBe(0);
    expect(yieldOver({ principalUsd: 5000, apyPercent: 0 }, 100)).toBe(0);
    expect(yieldOver({ principalUsd: 5000, apyPercent: 3.5 }, -5)).toBe(0);
  });
});

describe("principal withdrawal", () => {
  it("allows up to the deposited principal and rejects more, zero and junk", () => {
    expect(checkWithdrawPrincipal({ principalUsd: 100 }, 100)).toEqual({ ok: true });
    expect(checkWithdrawPrincipal({ principalUsd: 100 }, 100.01).ok).toBe(false);
    for (const bad of [0, -1, NaN]) expect(checkWithdrawPrincipal({ principalUsd: 100 }, bad).ok).toBe(false);
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

  it.each([1, 2, 3, 42, 2026])("seed %i: principal is never touched and spending never exceeds earned yield", (seed) => {
    const rand = rng(seed);
    let s = base({ principalUsd: 6900, apyPercent: 4, yieldUsd: 48.25, monthlyLimitUsd: 1_000_000 });
    let earned = s.yieldUsd;
    let spent = 0;

    for (let i = 0; i < 2000; i++) {
      const op = Math.floor(rand() * 5);
      const amt = Math.round(rand() * 400 * 100) / 100;
      const before = s;
      if (op === 0 || op === 1 || op === 2) {
        const d = op === 0 ? authorizeCardSpend(s, amt) : op === 1 ? purchaseVoucher(s, amt) : cashOut(s, amt);
        if (d.ok) {
          expect(d.funding.fromYield).toBeCloseTo(amt, 5);
          spent += amt;
          s = d.next;
        } else expect(d.next).toBe(before);
      } else if (op === 3) {
        const delta = rand() * 3;
        s = accrueYield(s, delta);
        earned += delta;
      } else {
        s = { ...s, frozen: rand() > 0.7 };
      }

      expect(s.principalUsd).toBe(6900); // spending never touches principal
      expect(s.yieldUsd).toBeGreaterThanOrEqual(0);
      expect(spent).toBeLessThanOrEqual(earned + 1e-4); // total spent can never exceed total earned
    }
  });
});

describe("latency", () => {
  it("a decision takes well under the 300 ms card-rail budget", () => {
    const s = base({ yieldUsd: 48.25 });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) authorizeCardSpend(s, 4.85);
    expect((performance.now() - t0) / 1000).toBeLessThan(300);
  });
});
