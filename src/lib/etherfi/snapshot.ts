/**
 * Turns the raw `CashLens.getSafeCashData()` response (plus DebtManager's liquidation-based max borrow)
 * into the app's `LiveSafe` model, and maps it onto the spend engine's `AccountState`.
 * Pure functions: no network, no React, so they are unit-tested against real captured responses.
 */
import { formatUnits, type Address } from "viem";
import { collateralTokenByAddress } from "../contracts/etherfi";
import { CASH_MODE } from "./abi";
import type { AccountState } from "@/utils/engine";

interface TokenData {
  token: Address;
  amount: bigint;
}

/** Shape returned by viem for `getSafeCashData` (see abi.ts). */
export interface RawSafeCashData {
  mode: number;
  collateralBalances: readonly TokenData[];
  borrows: readonly TokenData[];
  tokenPrices: readonly TokenData[];
  totalCollateral: bigint;
  totalBorrow: bigint;
  maxBorrow: bigint;
  creditMaxSpend: bigint;
  spendingLimitAllowance: bigint;
  totalCashbackEarnedInUsd: bigint;
  debitMaxSpend: { totalSpendableInUsd: bigint };
}

export interface LiveTokenBalance {
  address: Address;
  symbol: string;
  decimals: number;
  /** False when the token is not in the registry snapshot (decimals assumed 18). */
  known: boolean;
  amount: bigint;
  units: number;
  priceUsd: number;
  valueUsd: number;
  ltvBps: number | null;
  liqBps: number | null;
}

export interface LiveSafe {
  address: Address;
  mode: "credit" | "debit";
  collateral: LiveTokenBalance[];
  borrows: LiveTokenBalance[];
  totalCollateralUsd: number;
  totalBorrowUsd: number;
  /** Borrow limit at LTV (what the card can draw). */
  maxBorrowUsd: number;
  /** Borrow ceiling at the liquidation threshold (basis of the health factor). */
  liqMaxBorrowUsd: number;
  creditMaxSpendUsd: number;
  debitMaxSpendUsd: number;
  spendingLimitAllowanceUsd: number;
  totalCashbackUsd: number;
  /** liqMaxBorrow / totalBorrow; Infinity with no debt. */
  healthFactor: number;
}

/** Ether.fi reports USD amounts with 6 decimals. */
export const usd6 = (x: bigint): number => Number(x) / 1e6;

function toBalances(rows: readonly TokenData[], prices: Map<string, number>): LiveTokenBalance[] {
  return rows.map((r) => {
    const meta = collateralTokenByAddress(r.token);
    const decimals = meta?.decimals ?? 18;
    const units = Number(formatUnits(r.amount, decimals));
    const priceUsd = prices.get(r.token.toLowerCase()) ?? 0;
    return {
      address: r.token,
      symbol: meta?.symbol ?? `${r.token.slice(0, 6)}…`,
      decimals,
      known: !!meta,
      amount: r.amount,
      units,
      priceUsd,
      valueUsd: units * priceUsd,
      ltvBps: meta?.ltvBps ?? null,
      liqBps: meta?.liqBps ?? null,
    };
  });
}

export function parseSafeCashData(address: Address, raw: RawSafeCashData, liqMaxBorrow: bigint): LiveSafe {
  const prices = new Map(raw.tokenPrices.map((p) => [p.token.toLowerCase(), usd6(p.amount)] as const));
  const totalBorrowUsd = usd6(raw.totalBorrow);
  const liqMaxBorrowUsd = usd6(liqMaxBorrow);
  return {
    address,
    mode: raw.mode === CASH_MODE.Credit ? "credit" : "debit",
    collateral: toBalances(raw.collateralBalances, prices),
    borrows: toBalances(raw.borrows, prices),
    totalCollateralUsd: usd6(raw.totalCollateral),
    totalBorrowUsd,
    maxBorrowUsd: usd6(raw.maxBorrow),
    liqMaxBorrowUsd,
    creditMaxSpendUsd: usd6(raw.creditMaxSpend),
    debitMaxSpendUsd: usd6(raw.debitMaxSpend.totalSpendableInUsd),
    spendingLimitAllowanceUsd: usd6(raw.spendingLimitAllowance),
    totalCashbackUsd: usd6(raw.totalCashbackEarnedInUsd),
    healthFactor: totalBorrowUsd > 0 ? liqMaxBorrowUsd / totalBorrowUsd : Infinity,
  };
}

export interface LocalCardControls {
  frozen: boolean;
  monthlyLimitUsd: number;
  spentThisMonthUsd: number;
}

/**
 * Live position -> engine state, used as the fallback when the on-chain `canSpendSingleToken` check is unreachable.
 *
 * The contract's own numbers are authoritative, so the engine is aligned to them instead of re-deriving them:
 * - credit mode: the effective LTV is chosen so the engine's available limit equals `creditMaxSpend`
 *   (Ether.fi gates credit spends on lend-gateway capacity, not just collateral x LTV);
 * - debit mode: spends come from token balances without debt, which the engine models as its free "yield" rail;
 * - the Safe's remaining spending-limit allowance caps what can still be spent.
 * Yield and the micro-buffer are OrventYield constructs that do not exist on-chain, so they stay at zero.
 */
export function liveToAccount(live: LiveSafe, local: LocalCardControls): AccountState {
  const c = live.totalCollateralUsd;
  const debit = live.mode === "debit";
  const liqThreshold = c > 0 ? live.liqMaxBorrowUsd / c : 0;
  const maxLtv = debit || c <= 0 ? 0 : (live.totalBorrowUsd + live.creditMaxSpendUsd) / c;
  return {
    collateralUsd: c,
    maxLtv,
    liqThreshold: Math.max(liqThreshold, maxLtv),
    apyPercent: 0,
    debtUsd: live.totalBorrowUsd,
    advanceUsd: 0,
    yieldUsd: debit ? live.debitMaxSpendUsd : 0,
    // The live card is Ether.fi's, activated in their app; our activation gate applies to the Playground card only.
    cardActive: true,
    frozen: local.frozen,
    monthlyLimitUsd: Math.min(local.monthlyLimitUsd, local.spentThisMonthUsd + live.spendingLimitAllowanceUsd),
    spentThisMonthUsd: local.spentThisMonthUsd,
  };
}
