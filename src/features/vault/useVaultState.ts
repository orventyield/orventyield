"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { calculateHealthFactor, getHealthStatus, type HealthStatus } from "@/utils/math";
import {
  accrueYield,
  advanceRoom as advanceRoomOf,
  authorizeCardSpend,
  availableLimit as availableLimitOf,
  cashOut,
  microBuffer as microBufferOf,
  purchaseVoucher,
  repayDebtWithYield as repayEngine,
  type AccountState,
  type DeclineCode,
  type Funding,
} from "@/utils/engine";
import { ASSETS, checkWithdraw, positionFromHoldings, type AssetInfo, type AssetSymbol, type Holdings } from "@/utils/portfolio";
import {
  authCode,
  generateCardDetails,
  generateVoucherCode,
  simTxHash,
  type CardDetails,
  type VoucherBrandId,
} from "@/utils/card";
import { RAILS, maskDestination, validateDestination, type RailId } from "@/utils/payments";

/** Everything in this file is a SANDBOX simulation: no funds move and no transaction hits a chain. */

export type TokenOption = AssetInfo;
export const SUPPORTED_TOKENS = ASSETS;

export interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "card_spend" | "voucher_redeem" | "yield_repay" | "cashout";
  title: string;
  merchant?: string;
  amountUsd: number;
  timestamp: number;
  /** Simulated 32-byte hash (not on-chain). */
  txHash: string;
  simulated: true;
  status: "confirmed" | "pending";
  voucherCode?: string;
  rail?: string;
  funding?: Funding;
}

export interface Receipt {
  authCode: string;
  timestampIso: string;
  merchant: string;
  amountUsd: number;
  healthAfter: number;
  txHash: string;
  funding: Funding;
}

export interface SpendResult {
  success: boolean;
  /** Terminal-style reason, e.g. "CARD FROZEN". */
  error?: string;
  code?: DeclineCode;
  receipt?: Receipt;
}

interface Core {
  holdings: Holdings;
  debtUsd: number;
  advanceUsd: number;
  yieldUsd: number;
  frozen: boolean;
  monthlyLimitUsd: number;
  spentThisMonthUsd: number;
}

const INITIAL_CORE: Core = {
  holdings: { weETH: 2, USDC: 0, wstETH: 0 },
  debtUsd: 350,
  advanceUsd: 0,
  yieldUsd: 48.25,
  frozen: false,
  monthlyLimitUsd: 1500,
  spentThisMonthUsd: 0,
};

const DEMO_SEED = "orventyield-demo";
export const TIME_SCALES = [1, 100, 10_000] as const;
export type TimeScale = (typeof TIME_SCALES)[number];

function toAccount(c: Core): AccountState {
  const p = positionFromHoldings(c.holdings);
  return {
    collateralUsd: p.collateralUsd,
    maxLtv: p.maxLtv,
    apyPercent: p.apyPercent,
    debtUsd: c.debtUsd,
    advanceUsd: c.advanceUsd,
    yieldUsd: c.yieldUsd,
    frozen: c.frozen,
    monthlyLimitUsd: c.monthlyLimitUsd,
    spentThisMonthUsd: c.spentThisMonthUsd,
  };
}

function fromAccount(c: Core, a: AccountState): Core {
  return {
    ...c,
    debtUsd: a.debtUsd,
    advanceUsd: a.advanceUsd,
    yieldUsd: a.yieldUsd,
    frozen: a.frozen,
    monthlyLimitUsd: a.monthlyLimitUsd,
    spentThisMonthUsd: a.spentThisMonthUsd,
  };
}

const fmt = (n: number) => `$${n.toFixed(2)}`;

function friendly(code: DeclineCode, a: AccountState, what: "voucher" | "cashout"): string {
  switch (code) {
    case "INVALID_AMOUNT":
      return "Enter an amount greater than $0.";
    case "MONTHLY_LIMIT":
      return `Exceeds your monthly spending limit of ${fmt(a.monthlyLimitUsd)} (${fmt(a.spentThisMonthUsd)} used).`;
    case "INSUFFICIENT_YIELD":
      return what === "voucher"
        ? `Not enough accrued yield (${fmt(a.yieldUsd)} available). Pick a smaller voucher or fund it from the credit line.`
        : `Not enough accrued yield (${fmt(a.yieldUsd)} available). Turn on "Allow credit advance" to cover the rest.`;
    case "INSUFFICIENT_LIMIT":
      return `Not enough credit limit (${fmt(availableLimitOf(a))} available).`;
    case "HEALTH_FACTOR":
      return "Declined: this would push your Health Factor below 1.20x. Repay some debt first.";
    case "CARD_FROZEN":
      return "Card is frozen.";
  }
}

export function useVaultState() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();

  const [core, setCore] = useState<Core>(INITIAL_CORE);
  const coreRef = useRef<Core>(INITIAL_CORE);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<AssetSymbol>("weETH");
  const [timeScale, setTimeScale] = useState<TimeScale>(1);
  const counter = useRef(0);
  const isSandboxMode = true;

  /** Synchronous read-modify-write so callers always decide against the latest state. */
  const commit = useCallback((next: Core) => {
    coreRef.current = next;
    setCore(next);
  }, []);

  const record = useCallback((tx: Omit<Transaction, "id" | "timestamp" | "txHash" | "simulated" | "status">): Transaction => {
    counter.current += 1;
    const now = Date.now();
    const seed = `${tx.type}:${counter.current}:${tx.amountUsd}:${now}`;
    const full: Transaction = {
      ...tx,
      id: `tx-${counter.current}-${now}`,
      timestamp: now,
      txHash: simTxHash(seed),
      simulated: true,
      status: "confirmed",
    };
    setTransactions((prev) => [full, ...prev]);
    return full;
  }, []);

  const account = useMemo(() => toAccount(core), [core]);
  const position = useMemo(() => positionFromHoldings(core.holdings), [core.holdings]);
  const selectedToken = ASSETS[selectedSymbol];
  const collateralAmount = core.holdings[selectedSymbol];

  const availableLimit = availableLimitOf(account);
  const microBuffer = microBufferOf(account);
  const advanceRoom = advanceRoomOf(account);
  const healthFactor = calculateHealthFactor(position.collateralUsd, core.debtUsd, position.maxLtv);
  const healthStatus: HealthStatus = getHealthStatus(healthFactor);

  const card: CardDetails = useMemo(() => generateCardDetails(address ?? DEMO_SEED), [address]);

  // Real-time yield accrual (ticks every 250 ms; `timeScale` is a labelled demo accelerator).
  useEffect(() => {
    if (position.collateralUsd <= 0) return;
    const id = setInterval(() => {
      const c = coreRef.current;
      const p = positionFromHoldings(c.holdings);
      const delta = (p.collateralUsd * (p.apyPercent / 100) * 0.25 * timeScale) / 31_536_000;
      commit(fromAccount(c, accrueYield(toAccount(c), delta)));
    }, 250);
    return () => clearInterval(id);
  }, [position.collateralUsd, timeScale, commit]);

  const deposit = useCallback(
    (amount: number): { success: boolean; error?: string } => {
      if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Enter a valid amount" };
      const c = coreRef.current;
      commit({ ...c, holdings: { ...c.holdings, [selectedSymbol]: c.holdings[selectedSymbol] + amount } });
      record({ type: "deposit", title: `Deposited ${amount} ${selectedSymbol}`, amountUsd: amount * ASSETS[selectedSymbol].priceUsd });
      return { success: true };
    },
    [selectedSymbol, commit, record],
  );

  const withdraw = useCallback(
    (amount: number): { success: boolean; error?: string } => {
      const c = coreRef.current;
      const check = checkWithdraw(c.holdings, selectedSymbol, amount, c.debtUsd);
      if (!check.ok) return { success: false, error: check.reason };
      commit({ ...c, holdings: { ...c.holdings, [selectedSymbol]: c.holdings[selectedSymbol] - amount } });
      record({ type: "withdraw", title: `Withdrew ${amount} ${selectedSymbol}`, amountUsd: amount * ASSETS[selectedSymbol].priceUsd });
      return { success: true };
    },
    [selectedSymbol, commit, record],
  );

  const spendCard = useCallback(
    (amountUsd: number, merchant: string): SpendResult => {
      const c = coreRef.current;
      const d = authorizeCardSpend(toAccount(c), amountUsd);
      if (!d.ok) return { success: false, error: d.message, code: d.code };
      commit(fromAccount(c, d.next));
      const tx = record({
        type: "card_spend",
        title: `Card Swipe - ${merchant}`,
        merchant,
        amountUsd,
        funding: d.funding,
      });
      return {
        success: true,
        receipt: {
          authCode: authCode(tx.id),
          timestampIso: new Date(tx.timestamp).toISOString(),
          merchant,
          amountUsd,
          healthAfter: d.healthAfter,
          txHash: tx.txHash,
          funding: d.funding,
        },
      };
    },
    [commit, record],
  );

  const redeemVoucher = useCallback(
    (
      brand: VoucherBrandId,
      label: string,
      amountUsd: number,
      fundWith: "yield" | "credit",
    ): { success: boolean; voucherCode?: string; error?: string } => {
      const c = coreRef.current;
      const a = toAccount(c);
      const d = purchaseVoucher(a, amountUsd, fundWith);
      if (!d.ok) return { success: false, error: friendly(d.code, a, "voucher") };
      commit(fromAccount(c, d.next));
      const seed = `${brand}:${counter.current + 1}:${Date.now()}`;
      const code = generateVoucherCode(brand, seed);
      record({
        type: "voucher_redeem",
        title: `Gift Voucher - ${label} ($${amountUsd})`,
        merchant: label,
        amountUsd,
        voucherCode: code,
        funding: d.funding,
      });
      return { success: true, voucherCode: code };
    },
    [commit, record],
  );

  const cashoutBank = useCallback(
    (amountUsd: number, rail: RailId, destination: string, allowCredit: boolean): { success: boolean; error?: string } => {
      const railInfo = RAILS.find((r) => r.id === rail);
      if (!railInfo) return { success: false, error: "Unknown payout rail" };
      const v = validateDestination(rail, destination);
      if (!v.ok) return { success: false, error: v.error };
      const c = coreRef.current;
      const a = toAccount(c);
      const d = cashOut(a, amountUsd, allowCredit);
      if (!d.ok) return { success: false, error: friendly(d.code, a, "cashout") };
      commit(fromAccount(c, d.next));
      record({
        type: "cashout",
        title: `Bank Transfer (${railInfo.name}) to ${maskDestination(rail, v.normalized)}`,
        amountUsd,
        rail: railInfo.name,
        funding: d.funding,
      });
      return { success: true };
    },
    [commit, record],
  );

  const repayDebtWithYield = useCallback((): { success: boolean; repaidAmount: number } => {
    const c = coreRef.current;
    const r = repayEngine(toAccount(c));
    if (!r.ok) return { success: false, repaidAmount: 0 };
    commit(fromAccount(c, r.next));
    record({ type: "yield_repay", title: "Auto-Pilot: repaid debt with accrued yield", amountUsd: r.repaidUsd });
    return { success: true, repaidAmount: r.repaidUsd };
  }, [commit, record]);

  const setIsCardFrozen = useCallback(
    (frozen: boolean) => {
      commit({ ...coreRef.current, frozen });
    },
    [commit],
  );

  const setMonthlyLimit = useCallback(
    (limit: number) => {
      commit({ ...coreRef.current, monthlyLimitUsd: limit });
    },
    [commit],
  );

  const resetToDemo = useCallback(() => {
    commit(INITIAL_CORE);
    setTransactions([]);
    setSelectedSymbol("weETH");
    setTimeScale(1);
  }, [commit]);

  const setSelectedToken = useCallback((t: TokenOption) => setSelectedSymbol(t.symbol), []);

  return {
    isConnected,
    address,
    chainId,
    isSandboxMode,
    selectedToken,
    setSelectedToken,
    holdings: core.holdings,
    collateralAmount,
    collateralUsd: position.collateralUsd,
    blendedApy: position.apyPercent,
    blendedLtv: position.maxLtv,
    activeDebtUsd: core.debtUsd,
    advanceUsd: core.advanceUsd,
    accruedYieldUsd: core.yieldUsd,
    availableLimit,
    healthFactor,
    healthStatus,
    microBuffer,
    advanceRoom,
    card,
    isCardFrozen: core.frozen,
    setIsCardFrozen,
    monthlyLimit: core.monthlyLimitUsd,
    setMonthlyLimit,
    spentThisMonth: core.spentThisMonthUsd,
    transactions,
    timeScale,
    setTimeScale,
    deposit,
    withdraw,
    spendCard,
    redeemVoucher,
    cashoutBank,
    repayDebtWithYield,
    resetToDemo,
  };
}
