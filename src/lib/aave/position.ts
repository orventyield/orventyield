/**
 * Pure math for the yield-only account. Money is bigint (USDC has 6 decimals).
 *
 * Model: principal = everything ever supplied to the Safe's Aave position, minus withdrawals that leave to the owner
 * (principal exits). Yield withdrawals go to the Safe itself (then onward), so they do not reduce principal.
 * yield available = aToken balance - principal (never negative).
 */

export const RAY = 10n ** 27n;
export const SECONDS_PER_YEAR = 31_536_000;

export interface PoolEvent {
  kind: "supply" | "withdraw";
  amount: bigint;
  /** Supply: onBehalfOf. Withdraw: `to`. Lower-case. */
  counterparty: string;
  /** Where it happened, for the activity ledger. Absent in tests and when the RPC cannot say. */
  txHash?: string;
  /** Block time in milliseconds. */
  timestamp?: number;
}

export interface Position {
  principal: bigint;
  aBalance: bigint;
  yieldAvailable: bigint;
}

export function netPrincipal(events: PoolEvent[], safe: string): bigint {
  const s = safe.toLowerCase();
  let p = 0n;
  for (const e of events) {
    if (e.kind === "supply" && e.counterparty.toLowerCase() === s) p += e.amount;
    // A withdrawal sent anywhere except the Safe itself is a principal exit.
    if (e.kind === "withdraw" && e.counterparty.toLowerCase() !== s) p -= e.amount;
  }
  return p < 0n ? 0n : p;
}

export function positionOf(events: PoolEvent[], safe: string, aBalance: bigint): Position {
  // Principal is what the user put in, exactly. Aave can round the balance 1 unit below it right after a supply; that
  // shows as zero yield, never as a smaller principal.
  const principal = netPrincipal(events, safe);
  return { principal, aBalance, yieldAvailable: aBalance > principal ? aBalance - principal : 0n };
}

/** Most principal that can be withdrawn right now (never more than the position actually holds). */
export function maxPrincipalWithdrawal(p: Position): bigint {
  return p.principal < p.aBalance ? p.principal : p.aBalance;
}

/** Aave reports a per-second-compounded APR in ray; APY compounds it yearly. */
export function rayToApy(liquidityRate: bigint): number {
  if (liquidityRate <= 0n) return 0;
  const apr = Number(liquidityRate) / Number(RAY);
  return Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
}

/** Yield earned per second on `aBalance` at the current rate, in token base units (float, for a ticking display only). */
export function yieldPerSecond(aBalance: bigint, liquidityRate: bigint): number {
  return (Number(aBalance) * (Number(liquidityRate) / Number(RAY))) / SECONDS_PER_YEAR;
}

/** Largest yield withdrawal that is safe to submit: leave a 1-unit margin for rounding. */
export function maxYieldWithdrawal(p: Position): bigint {
  return p.yieldAvailable > 1n ? p.yieldAvailable - 1n : 0n;
}
