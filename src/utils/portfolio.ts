/**
 * Multi-asset collateral helpers. Each asset has its own price, APY and max LTV, so the account
 * uses value-weighted ("blended") LTV and APY. Prices/APYs here are SANDBOX assumptions, not live data.
 */
import { MIN_HEALTH_FACTOR, healthFactor, r6 } from "./engine";

export type AssetSymbol = "weETH" | "USDC" | "wstETH";

export interface AssetInfo {
  symbol: AssetSymbol;
  name: string;
  priceUsd: number;
  apyPercent: number;
  maxLtv: number;
}

export const ASSETS: Record<AssetSymbol, AssetInfo> = {
  weETH: { symbol: "weETH", name: "Ether.fi weETH", priceUsd: 3450, apyPercent: 3.1, maxLtv: 0.75 },
  USDC: { symbol: "USDC", name: "USD Coin", priceUsd: 1, apyPercent: 5.0, maxLtv: 0.85 },
  wstETH: { symbol: "wstETH", name: "Lido wstETH", priceUsd: 3980, apyPercent: 3.2, maxLtv: 0.75 },
};

export type Holdings = Record<AssetSymbol, number>;

export interface Position {
  collateralUsd: number;
  /** Value-weighted max LTV (0-1). */
  maxLtv: number;
  /** Value-weighted APY, percent. */
  apyPercent: number;
}

export function positionFromHoldings(h: Holdings, assets: Record<AssetSymbol, AssetInfo> = ASSETS): Position {
  let value = 0;
  let ltvSum = 0;
  let apySum = 0;
  for (const sym of Object.keys(h) as AssetSymbol[]) {
    const a = assets[sym];
    const v = Math.max(0, h[sym]) * a.priceUsd;
    value += v;
    ltvSum += v * a.maxLtv;
    apySum += v * a.apyPercent;
  }
  if (value <= 0) return { collateralUsd: 0, maxLtv: 0, apyPercent: 0 };
  return { collateralUsd: r6(value), maxLtv: ltvSum / value, apyPercent: apySum / value };
}

export interface WithdrawCheck {
  ok: boolean;
  healthAfter: number;
  reason?: string;
}

/** Can `amount` of `symbol` be withdrawn while keeping HF >= 1.20x on existing debt? */
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
  const hf = healthFactor(p.collateralUsd, p.maxLtv, debtUsd);
  if (debtUsd > 0 && hf < MIN_HEALTH_FACTOR) {
    return {
      ok: false,
      healthAfter: hf,
      reason: `Withdrawal rejected: Health Factor would drop to ${hf.toFixed(2)}x (minimum ${MIN_HEALTH_FACTOR.toFixed(2)}x). Repay some debt first.`,
    };
  }
  return { ok: true, healthAfter: hf };
}
