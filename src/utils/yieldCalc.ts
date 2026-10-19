/**
 * Yield-only spending maths for the public calculator. Pure functions, plain numbers in USD (illustration only; the
 * app itself uses bigint on-chain balances). APY is a percentage, e.g. 4 means 4%.
 */

export const MONTHS = 12;

export const yearlyYield = (principal: number, apyPercent: number): number =>
  principal > 0 && apyPercent > 0 ? principal * (apyPercent / 100) : 0;

export const monthlyYield = (principal: number, apyPercent: number): number => yearlyYield(principal, apyPercent) / MONTHS;

/** Principal needed so that yield alone covers `monthlySpend`. Infinity when the APY is zero and spend is positive. */
export function principalNeeded(monthlySpend: number, apyPercent: number): number {
  if (!(monthlySpend > 0)) return 0;
  if (!(apyPercent > 0)) return Infinity;
  return (monthlySpend * MONTHS) / (apyPercent / 100);
}

/** Share of the monthly spend that yield covers, clamped to 0..1. Zero spend counts as fully covered. */
export function coverage(principal: number, apyPercent: number, monthlySpend: number): number {
  if (!(monthlySpend > 0)) return 1;
  return Math.min(1, monthlyYield(principal, apyPercent) / monthlySpend);
}

/**
 * What can actually be spent this month: never more than the yield earned, so principal is untouched by design.
 * `shortfall` is the part of the wish that yield cannot cover.
 */
export function spendPlan(principal: number, apyPercent: number, monthlySpend: number): { spendable: number; shortfall: number } {
  const y = monthlyYield(principal, apyPercent);
  const wish = monthlySpend > 0 ? monthlySpend : 0;
  const spendable = Math.min(wish, y);
  return { spendable, shortfall: wish - spendable };
}
