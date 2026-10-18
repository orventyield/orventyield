/**
 * OrventYield Pure Financial Math Functions
 * All formulas for available limit, health factor, and yield streaming.
 */

export interface HealthStatus {
  status: "safe" | "warning" | "danger";
  label: string;
  colorClass: string;
}

/**
 * Available Limit = (Collateral Value * Max LTV) - Active Debt
 */
export function calculateAvailableLimit(
  collateralUsd: number,
  debtUsd: number,
  maxLtv: number = 0.75
): number {
  if (collateralUsd <= 0) return 0;
  const maxBorrow = collateralUsd * maxLtv;
  return Math.max(0, Number((maxBorrow - debtUsd).toFixed(2)));
}

/**
 * Health Factor = (Collateral Value * Max LTV) / Active Debt
 * Returns 999 when debt is 0 (infinite safety).
 */
export function calculateHealthFactor(
  collateralUsd: number,
  debtUsd: number,
  maxLtv: number = 0.75
): number {
  if (debtUsd <= 0) return 999;
  if (collateralUsd <= 0) return 0;
  const ratio = (collateralUsd * maxLtv) / debtUsd;
  return Number(ratio.toFixed(2));
}

/**
 * Evaluates health status according to PRD section 7.3:
 * Safe: > 1.5x
 * Warning: 1.2x - 1.5x
 * Danger: < 1.2x
 */
export function getHealthStatus(healthFactor: number): HealthStatus {
  if (healthFactor >= 1.5) {
    return {
      status: "safe",
      label: "Safe (> 1.5x)",
      colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
    };
  }
  if (healthFactor >= 1.2) {
    return {
      status: "warning",
      label: "Moderate (1.2x - 1.5x)",
      colorClass: "text-amber-400 border-amber-500/30 bg-amber-500/10"
    };
  }
  return {
    status: "danger",
    label: "Liquidation Risk (< 1.2x)",
    colorClass: "text-rose-400 border-rose-500/30 bg-rose-500/10"
  };
}

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

/**
 * Rolling 7-day predictive micro-buffer calculation
 */
export function calculateMicroBuffer(
  collateralUsd: number,
  apyPercent: number = 8.0,
  days: number = 7
): number {
  if (collateralUsd <= 0) return 0;
  const dailyRate = (apyPercent / 100) / 365;
  const buffer = collateralUsd * dailyRate * days;
  return Number(buffer.toFixed(2));
}
