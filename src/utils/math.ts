/**
 * OrventYield pure financial math: yield streaming.
 */

/**
 * Continuous real-time yield accrual:
 * Accrued Yield = Principal * (APY / 100) * (Elapsed Seconds / Seconds Per Year)
 */
export function calculateAccruedYield(
  principalUsd: number,
  apyPercent: number,
  elapsedSeconds: number
): number {
  if (principalUsd <= 0 || apyPercent <= 0) return 0;
  const SECONDS_PER_YEAR = 31536000;
  const yieldAmount = principalUsd * (apyPercent / 100) * (elapsedSeconds / SECONDS_PER_YEAR);
  return Number(yieldAmount.toFixed(6));
}
