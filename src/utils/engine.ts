/**
 * OrventYield sandbox spend engine.
 *
 * Pure, deterministic functions that decide whether a spend is authorised and how it is funded.
 * Nothing here touches the chain: it models the rules a card rail would enforce so they can be
 * unit-tested. Amounts are USD, rounded to 6 decimals to avoid float drift.
 *
 * Risk model: the borrow limit uses each asset's LTV, the health factor
 * uses its liquidation threshold (HF = collateral x liqThreshold / debt).
 *
 * Funding waterfall for a card spend (first match wins, each leg is capped):
 *   1. settled yield      - free, no debt, collateral untouched
 *   2. yield advance      - overdraft backed by the 7-day predicted yield ("micro-buffer"),
 *                           collateral-free and auto-repaid from newly accrued yield
 *   3. credit line        - borrow against collateral, gated by the available limit and HF >= 1.20x
 *
 * One user = one card: `issueCard` is the only way a card becomes active in the engine. It rejects a second card for
 * the same verified identity or the same owner (see lib/identity/registry.ts; the server enforces the same rule).
 * A swipe on a card that is not active is declined.
 *
 * Invariants (covered by tests/unit/engine.test.ts):
 *   - spending never reduces collateral (principal)
 *   - an approved spend never leaves the health factor below MIN_HEALTH_FACTOR
 *   - a frozen card declines everything
 *   - outstanding advance never exceeds the micro-buffer
 */
import { claimCard, type CardRegistry, type ClaimRejection } from "../lib/identity/registry";
import { calculateMicroBuffer } from "./math";

export const MIN_HEALTH_FACTOR = 1.2;
export const BUFFER_DAYS = 7;

export interface AccountState {
  /** Principal. Only deposits/withdrawals change it, never spending. */
  collateralUsd: number;
  /** Blended max loan-to-value across held assets (0-1): sets the borrow limit. */
  maxLtv: number;
  /** Blended liquidation threshold (0-1): sets the health factor. Always >= maxLtv. */
  liqThreshold: number;
  /** Blended collateral APY, percent. */
  apyPercent: number;
  /** Collateral-backed credit-line debt. */
  debtUsd: number;
  /** Yield-backed overdraft advance outstanding; repaid first from new yield. */
  advanceUsd: number;
  /** Settled, spendable accrued yield. */
  yieldUsd: number;
  /** The card has been activated through phone verification. Spending requires it. */
  cardActive: boolean;
  frozen: boolean;
  monthlyLimitUsd: number;
  /** Total outflow this month (card + vouchers + cashouts). */
  spentThisMonthUsd: number;
}

export type DeclineCode =
  | "INVALID_AMOUNT"
  | "CARD_NOT_ACTIVE"
  | "CARD_FROZEN"
  | "MONTHLY_LIMIT"
  | "INSUFFICIENT_YIELD"
  | "INSUFFICIENT_LIMIT"
  | "HEALTH_FACTOR";

export interface Funding {
  fromYield: number;
  fromAdvance: number;
  fromCredit: number;
}

export type Decision =
  | {
      ok: true;
      funding: Funding;
      next: AccountState;
      healthBefore: number;
      healthAfter: number;
    }
  | {
      ok: false;
      code: DeclineCode;
      /** Uppercase terminal text, e.g. "CARD FROZEN". */
      message: string;
      next: AccountState;
    };

const MESSAGES: Record<DeclineCode, string> = {
  INVALID_AMOUNT: "INVALID AMOUNT",
  CARD_NOT_ACTIVE: "CARD NOT ACTIVATED",
  CARD_FROZEN: "CARD FROZEN",
  MONTHLY_LIMIT: "MONTHLY LIMIT EXCEEDED",
  INSUFFICIENT_YIELD: "INSUFFICIENT YIELD",
  INSUFFICIENT_LIMIT: "INSUFFICIENT LIMIT",
  HEALTH_FACTOR: "HEALTH FACTOR BELOW 1.20X",
};

export const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Unrounded health factor used for gating: collateral x liquidation threshold / debt.
 * Display code may round; gates must not.
 */
export function healthFactor(collateralUsd: number, liqThreshold: number, debtUsd: number): number {
  if (debtUsd <= 0) return Infinity;
  if (collateralUsd <= 0) return 0;
  return (collateralUsd * liqThreshold) / debtUsd;
}

export function availableLimit(s: Pick<AccountState, "collateralUsd" | "maxLtv" | "debtUsd">): number {
  return Math.max(0, r6(s.collateralUsd * s.maxLtv - s.debtUsd));
}

export function microBuffer(s: Pick<AccountState, "collateralUsd" | "apyPercent">): number {
  return calculateMicroBuffer(s.collateralUsd, s.apyPercent, BUFFER_DAYS);
}

/** Buffer still available for new advances. */
export function advanceRoom(s: AccountState): number {
  return Math.max(0, r6(microBuffer(s) - s.advanceUsd));
}

function decline(s: AccountState, code: DeclineCode): Decision {
  return { ok: false, code, message: MESSAGES[code], next: s };
}

function validAmount(a: number): boolean {
  return Number.isFinite(a) && a > 0;
}

/** Draw `credit` from the credit line, enforcing the limit and the HF floor. */
function drawCredit(s: AccountState, credit: number): { ok: true; debt: number } | { ok: false; code: DeclineCode } {
  if (credit <= 0) return { ok: true, debt: s.debtUsd };
  if (credit > availableLimit(s)) return { ok: false, code: "INSUFFICIENT_LIMIT" };
  const debt = r6(s.debtUsd + credit);
  if (healthFactor(s.collateralUsd, s.liqThreshold, debt) < MIN_HEALTH_FACTOR) return { ok: false, code: "HEALTH_FACTOR" };
  return { ok: true, debt };
}

/** Card swipe at a POS terminal. */
export function authorizeCardSpend(s: AccountState, amountUsd: number): Decision {
  if (!s.cardActive) return decline(s, "CARD_NOT_ACTIVE");
  if (s.frozen) return decline(s, "CARD_FROZEN");
  if (!validAmount(amountUsd)) return decline(s, "INVALID_AMOUNT");
  const amount = r6(amountUsd);
  if (r6(s.spentThisMonthUsd + amount) > s.monthlyLimitUsd) return decline(s, "MONTHLY_LIMIT");

  const fromYield = Math.min(amount, s.yieldUsd);
  const afterYield = r6(amount - fromYield);
  const fromAdvance = Math.min(afterYield, advanceRoom(s));
  const fromCredit = r6(afterYield - fromAdvance);

  const credit = drawCredit(s, fromCredit);
  if (!credit.ok) return decline(s, credit.code);

  const healthBefore = healthFactor(s.collateralUsd, s.liqThreshold, s.debtUsd);
  const healthAfter = healthFactor(s.collateralUsd, s.liqThreshold, credit.debt);
  // Spec: HF must be >= 1.20x after the transaction, whatever funded it.
  if (healthAfter < MIN_HEALTH_FACTOR) return decline(s, "HEALTH_FACTOR");

  return {
    ok: true,
    funding: { fromYield: r6(fromYield), fromAdvance: r6(fromAdvance), fromCredit },
    healthBefore,
    healthAfter,
    next: {
      ...s,
      yieldUsd: r6(s.yieldUsd - fromYield),
      advanceUsd: r6(s.advanceUsd + fromAdvance),
      debtUsd: credit.debt,
      spentThisMonthUsd: r6(s.spentThisMonthUsd + amount),
    },
  };
}

export type VoucherFunding = "yield" | "credit";

/** Digital voucher purchase. "yield" is strictly free: $0 debt, no advance, collateral untouched. */
export function purchaseVoucher(s: AccountState, amountUsd: number, funding: VoucherFunding): Decision {
  if (!validAmount(amountUsd)) return decline(s, "INVALID_AMOUNT");
  const amount = r6(amountUsd);
  if (r6(s.spentThisMonthUsd + amount) > s.monthlyLimitUsd) return decline(s, "MONTHLY_LIMIT");

  const healthBefore = healthFactor(s.collateralUsd, s.liqThreshold, s.debtUsd);
  if (funding === "yield") {
    if (amount > s.yieldUsd) return decline(s, "INSUFFICIENT_YIELD");
    return {
      ok: true,
      funding: { fromYield: amount, fromAdvance: 0, fromCredit: 0 },
      healthBefore,
      healthAfter: healthBefore,
      next: { ...s, yieldUsd: r6(s.yieldUsd - amount), spentThisMonthUsd: r6(s.spentThisMonthUsd + amount) },
    };
  }

  const credit = drawCredit(s, amount);
  if (!credit.ok) return decline(s, credit.code);
  return {
    ok: true,
    funding: { fromYield: 0, fromAdvance: 0, fromCredit: amount },
    healthBefore,
    healthAfter: healthFactor(s.collateralUsd, s.liqThreshold, credit.debt),
    next: { ...s, debtUsd: credit.debt, spentThisMonthUsd: r6(s.spentThisMonthUsd + amount) },
  };
}

/** Bank/UPI payout. Uses yield first; only draws credit when the user opts in. */
export function cashOut(s: AccountState, amountUsd: number, allowCredit: boolean): Decision {
  if (!validAmount(amountUsd)) return decline(s, "INVALID_AMOUNT");
  const amount = r6(amountUsd);
  if (r6(s.spentThisMonthUsd + amount) > s.monthlyLimitUsd) return decline(s, "MONTHLY_LIMIT");

  const fromYield = Math.min(amount, s.yieldUsd);
  const fromCredit = r6(amount - fromYield);
  if (fromCredit > 0 && !allowCredit) return decline(s, "INSUFFICIENT_YIELD");

  const credit = drawCredit(s, fromCredit);
  if (!credit.ok) return decline(s, credit.code);

  return {
    ok: true,
    funding: { fromYield: r6(fromYield), fromAdvance: 0, fromCredit },
    healthBefore: healthFactor(s.collateralUsd, s.liqThreshold, s.debtUsd),
    healthAfter: healthFactor(s.collateralUsd, s.liqThreshold, credit.debt),
    next: {
      ...s,
      yieldUsd: r6(s.yieldUsd - fromYield),
      debtUsd: credit.debt,
      spentThisMonthUsd: r6(s.spentThisMonthUsd + amount),
    },
  };
}

/** New yield arrives: repay any outstanding advance first, the rest becomes spendable. */
export function accrueYield(s: AccountState, deltaUsd: number): AccountState {
  if (!validAmount(deltaUsd)) return s;
  const toAdvance = Math.min(deltaUsd, s.advanceUsd);
  return {
    ...s,
    advanceUsd: r6(s.advanceUsd - toAdvance),
    yieldUsd: r6(s.yieldUsd + (deltaUsd - toAdvance)),
  };
}

export interface RepayResult {
  ok: boolean;
  repaidUsd: number;
  healthBefore: number;
  healthAfter: number;
  next: AccountState;
}

/** "Auto-Pilot": sweep settled yield into the credit-line debt. Principal is never touched. */
export function repayDebtWithYield(s: AccountState): RepayResult {
  const healthBefore = healthFactor(s.collateralUsd, s.liqThreshold, s.debtUsd);
  const repay = r6(Math.min(s.debtUsd, s.yieldUsd));
  if (repay <= 0) return { ok: false, repaidUsd: 0, healthBefore, healthAfter: healthBefore, next: s };
  const next = { ...s, debtUsd: r6(s.debtUsd - repay), yieldUsd: r6(s.yieldUsd - repay) };
  return { ok: true, repaidUsd: repay, healthBefore, healthAfter: healthFactor(next.collateralUsd, next.liqThreshold, next.debtUsd), next };
}

/** The set of verified identities that hold a card, as the engine sees them. */
export type { CardRegistry };

export type IssueCardResult =
  | { ok: true; registry: CardRegistry; idempotent: boolean }
  | { ok: false; code: ClaimRejection; message: string; registry: CardRegistry };

/**
 * Create (activate) a card for `owner`, bound to a verified identity. Rejects duplicates:
 * "Card already active for this verified identity." for a second owner on the same identity,
 * and "This account already has an active card." for a second identity on the same owner.
 */
export function issueCard(registry: CardRegistry, owner: string, identityId: string): IssueCardResult {
  return claimCard(registry, owner, identityId);
}
