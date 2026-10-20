/**
 * OrventYield Playground spend engine: the "spend the yield, keep the principal" model.
 *
 * Pure, deterministic functions that decide whether a spend is authorised. Nothing here touches the chain: it models
 * the rules the real product enforces (Safe + Aave, where only earned yield can leave) so they can be unit-tested.
 * Amounts are USD, rounded to 6 decimals to avoid float drift.
 *
 * There is no borrowing: no credit line, no debt, no health factor, no liquidation. A spend, voucher or payout is paid
 * from earned yield and nothing else.
 *
 * One user = one card: `issueCard` is the only way a card becomes active in the engine. It rejects a second card for
 * the same verified identity or the same owner (see lib/identity/registry.ts; the server enforces the same rule).
 * A swipe on a card that is not active is declined.
 *
 * Invariants (covered by tests/unit/engine.test.ts):
 *   - spending never reduces principal
 *   - an approved spend never exceeds the earned yield
 *   - a frozen or inactive card declines everything
 *   - the monthly limit is never exceeded
 */
import { claimCard, type CardRegistry, type ClaimRejection } from "../lib/identity/registry";

export interface AccountState {
  /** USDC deposited. Only deposits and principal withdrawals change it, never spending. */
  principalUsd: number;
  /** Yield rate, percent per year. */
  apyPercent: number;
  /** Earned, spendable yield. */
  yieldUsd: number;
  /** The card has been activated through phone verification. Card spending requires it. */
  cardActive: boolean;
  frozen: boolean;
  monthlyLimitUsd: number;
  /** Total outflow this month (card + vouchers + cashouts). */
  spentThisMonthUsd: number;
}

export type DeclineCode = "INVALID_AMOUNT" | "CARD_NOT_ACTIVE" | "CARD_FROZEN" | "MONTHLY_LIMIT" | "INSUFFICIENT_YIELD";

export interface Funding {
  /** Always the whole amount: yield is the only funding source. */
  fromYield: number;
}

export type Decision =
  | { ok: true; funding: Funding; next: AccountState }
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
  INSUFFICIENT_YIELD: "EXCEEDS EARNED YIELD",
};

export const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** What can be spent right now: the earned yield. */
export function spendable(s: Pick<AccountState, "yieldUsd">): number {
  return Math.max(0, r6(s.yieldUsd));
}

function decline(s: AccountState, code: DeclineCode): Decision {
  return { ok: false, code, message: MESSAGES[code], next: s };
}

const validAmount = (a: number): boolean => Number.isFinite(a) && a > 0;

/** Shared gate for every outflow: valid amount, monthly limit, enough earned yield. */
function pay(s: AccountState, amountUsd: number): Decision {
  if (!validAmount(amountUsd)) return decline(s, "INVALID_AMOUNT");
  const amount = r6(amountUsd);
  if (r6(s.spentThisMonthUsd + amount) > s.monthlyLimitUsd) return decline(s, "MONTHLY_LIMIT");
  if (amount > spendable(s)) return decline(s, "INSUFFICIENT_YIELD");
  return {
    ok: true,
    funding: { fromYield: amount },
    next: { ...s, yieldUsd: r6(s.yieldUsd - amount), spentThisMonthUsd: r6(s.spentThisMonthUsd + amount) },
  };
}

/** Card swipe at a POS terminal. */
export function authorizeCardSpend(s: AccountState, amountUsd: number): Decision {
  if (!s.cardActive) return decline(s, "CARD_NOT_ACTIVE");
  if (s.frozen) return decline(s, "CARD_FROZEN");
  return pay(s, amountUsd);
}

/** Digital voucher purchase, paid from earned yield. */
export function purchaseVoucher(s: AccountState, amountUsd: number): Decision {
  return pay(s, amountUsd);
}

/** Bank/UPI payout, paid from earned yield. */
export function cashOut(s: AccountState, amountUsd: number): Decision {
  return pay(s, amountUsd);
}

/** New yield arrives and becomes spendable. */
export function accrueYield(s: AccountState, deltaUsd: number): AccountState {
  if (!validAmount(deltaUsd)) return s;
  return { ...s, yieldUsd: r6(s.yieldUsd + deltaUsd) };
}

/** Yield earned over `seconds` at the account's APY: principal x APY x seconds / year. */
export function yieldOver(s: Pick<AccountState, "principalUsd" | "apyPercent">, seconds: number): number {
  if (s.principalUsd <= 0 || s.apyPercent <= 0 || !(seconds > 0)) return 0;
  return (s.principalUsd * (s.apyPercent / 100) * seconds) / 31_536_000;
}

export type WithdrawCheck = { ok: true } | { ok: false; reason: string };

/** Principal can always be withdrawn, up to what is deposited. */
export function checkWithdrawPrincipal(s: Pick<AccountState, "principalUsd">, amountUsd: number): WithdrawCheck {
  if (!validAmount(amountUsd)) return { ok: false, reason: "Enter a valid amount" };
  if (r6(amountUsd) > r6(s.principalUsd)) return { ok: false, reason: "That is more than your deposited principal." };
  return { ok: true };
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
