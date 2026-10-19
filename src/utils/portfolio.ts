/**
 * Multi-asset collateral helpers. Risk parameters mirror Ether.fi Cash's DebtManager on Optimism
 * (src/lib/contracts/etherfi.ts): each asset has an LTV (borrow limit) and a liquidation threshold (health factor).
 * The account uses value-weighted ("blended") values. Prices and APYs are SANDBOX assumptions
 * (prices snapshotted from the Ether.fi PriceProvider on 2026-10-19; APYs are illustrative).
 */
import { MIN_HEALTH_FACTOR, healthFactor, r6 } from "./engine";

export type AssetSymbol = "weETH" | "USDC" | "WETH";

export interface AssetInfo {
  symbol: AssetSymbol;
  name: string;
  priceUsd: number;
  apyPercent: number;
  /** Max borrow as a fraction of value (DebtManager ltv). */
  maxLtv: number;
  /** Liquidation threshold as a fraction of value. */
  liqThreshold: number;
}

export const ASSETS: Record<AssetSymbol, AssetInfo> = {
  weETH: { symbol: "weETH", name: "Ether.fi weETH", priceUsd: 2681.15, apyPercent: 3.1, maxLtv: 0.55, liqThreshold: 0.75 },
  USDC: { symbol: "USDC", name: "USD Coin", priceUsd: 1, apyPercent: 4.0, maxLtv: 0.9, liqThreshold: 0.95 },
  WETH: { symbol: "WETH", name: "Wrapped Ether", priceUsd: 2428.27, apyPercent: 0, maxLtv: 0.55, liqThreshold: 0.75 },
};

export type Holdings = Record<AssetSymbol, number>;

export interface Position {
  collateralUsd: number;
  /** Value-weighted max LTV (0-1). */
  maxLtv: number;
  /** Value-weighted liquidation threshold (0-1). */
  liqThreshold: number;
  /** Value-weighted APY, percent. */
  apyPercent: number;
}

export function positionFromHoldings(h: Holdings, assets: Record<AssetSymbol, AssetInfo> = ASSETS): Position {
  let value = 0;
  let ltvSum = 0;
  let liqSum = 0;
  let apySum = 0;
  for (const sym of Object.keys(h) as AssetSymbol[]) {
    const a = assets[sym];
    const v = Math.max(0, h[sym]) * a.priceUsd;
    value += v;
    ltvSum += v * a.maxLtv;
    liqSum += v * a.liqThreshold;
    apySum += v * a.apyPercent;
  }
  if (value <= 0) return { collateralUsd: 0, maxLtv: 0, liqThreshold: 0, apyPercent: 0 };
  return { collateralUsd: r6(value), maxLtv: ltvSum / value, liqThreshold: liqSum / value, apyPercent: apySum / value };
}

export interface WithdrawCheck {
  ok: boolean;
  healthAfter: number;
  reason?: string;
}

/**
 * Can `amount` of `symbol` be withdrawn? Like Ether.fi, the remaining position must still cover the debt at the
 * LTV borrow limit, and this sandbox additionally keeps HF >= 1.20x.
 */
export function checkWithdraw(
  h: Holdings,
  symbol: AssetSymbol,
  amount: number,
  debtUsd: number,
  assets: Record<AssetSymbol, AssetInfo> = ASSETS,
): WithdrawCheck {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, healthAfter: Infinity, reason: "Enter a valid amount" };
  if (amount > h[symbol]) return { ok: false, healthAfter: Infinity, reason: `Insufficient ${symbol} balance` };
  const next = { ...h, [symbol]: h[symbol] - amount };
  const p = positionFromHoldings(next, assets);
  const hf = healthFactor(p.collateralUsd, p.liqThreshold, debtUsd);
  if (debtUsd > 0 && debtUsd > p.collateralUsd * p.maxLtv) {
    return {
      ok: false,
      healthAfter: hf,
      reason: "Withdrawal rejected: your remaining collateral would not cover your debt at the borrow limit. Repay some debt first.",
    };
  }
  if (debtUsd > 0 && hf < MIN_HEALTH_FACTOR) {
    return {
      ok: false,
      healthAfter: hf,
      reason: `Withdrawal rejected: Health Factor would drop to ${hf.toFixed(2)}x (minimum ${MIN_HEALTH_FACTOR.toFixed(2)}x). Repay some debt first.`,
    };
  }
  return { ok: true, healthAfter: hf };
}
