"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  accrueYield,
  authorizeCardSpend,
  cashOut,
  checkWithdrawPrincipal,
  purchaseVoucher,
  spendable,
  yieldOver,
  type AccountState,
  type DeclineCode,
  type Funding,
} from "@/utils/engine";
import { authCode, generateCardDetails, generateVoucherCode, simTxHash, type CardDetails, type VoucherBrandId } from "@/utils/card";
import { RAILS, maskDestination, validateDestination, type RailId } from "@/utils/payments";

/** Everything in this file is a SANDBOX simulation: no funds move and no transaction hits a chain. */

export interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "card_spend" | "voucher_redeem" | "cashout";
  title: string;
  merchant?: string;
  amountUsd: number;
  timestamp: number;
  /** Simulated 32-byte hash in the Playground; the real transaction hash on Mainnet (empty when unknown). */
  txHash: string;
  simulated: boolean;
  /** Block explorer link for a real transaction. */
  explorerUrl?: string;
  /** Where it happened when that is neither the Playground nor the chain, e.g. "Card network". */
  label?: string;
  status: "confirmed" | "pending";
  voucherCode?: string;
  rail?: string;
  funding?: Funding;
}

/** "sandbox" = the Playground engine; "mainnet-preview" = a swipe tested against real earned yield (nothing charged). */
export type VerdictSource = "sandbox" | "mainnet-preview";

export interface Receipt {
  authCode: string;
  timestampIso: string;
  merchant: string;
  amountUsd: number;
  /** Simulated hash in the playground; null when nothing was sent (live preview). */
  txHash: string | null;
  funding: Funding | null;
  source: VerdictSource;
  /** Measured decision time in milliseconds, when the source measured it. */
  latencyMs?: number;
}

export interface SpendResult {
  success: boolean;
  /** Terminal-style reason, e.g. "CARD FROZEN". */
  error?: string;
  code?: DeclineCode;
  receipt?: Receipt;
  source?: VerdictSource;
  latencyMs?: number;
}

interface Core {
  /** Card activated through phone verification (one user = one card). */
  cardActive: boolean;
  principalUsd: number;
  yieldUsd: number;
  frozen: boolean;
  monthlyLimitUsd: number;
  spentThisMonthUsd: number;
}

/** Illustrative Playground yield rate. Mainnet reads the real rate from Aave. */
export const DEMO_APY = 3.5;

const INITIAL_CORE: Core = {
  cardActive: true,
  principalUsd: 5000,
  yieldUsd: 12.4,
  frozen: false,
  monthlyLimitUsd: 1500,
  spentThisMonthUsd: 0,
};

const DEMO_SEED = "orventyield-demo";
export const TIME_SCALES = [1, 100, 10_000] as const;
export type TimeScale = (typeof TIME_SCALES)[number];

const toAccount = (c: Core): AccountState => ({
  principalUsd: c.principalUsd,
  apyPercent: DEMO_APY,
  yieldUsd: c.yieldUsd,
  cardActive: c.cardActive,
  frozen: c.frozen,
  monthlyLimitUsd: c.monthlyLimitUsd,
  spentThisMonthUsd: c.spentThisMonthUsd,
});

const fromAccount = (c: Core, a: AccountState): Core => ({
  ...c,
  yieldUsd: a.yieldUsd,
  frozen: a.frozen,
  monthlyLimitUsd: a.monthlyLimitUsd,
  spentThisMonthUsd: a.spentThisMonthUsd,
});

const fmt = (n: number) => `$${n.toFixed(2)}`;

function friendly(code: DeclineCode, a: AccountState): string {
  switch (code) {
    case "INVALID_AMOUNT":
      return "Enter an amount greater than $0.";
    case "MONTHLY_LIMIT":
      return `Exceeds your monthly spending limit of ${fmt(a.monthlyLimitUsd)} (${fmt(a.spentThisMonthUsd)} used).`;
    case "INSUFFICIENT_YIELD":
      return `Only earned yield can be spent, and you have ${fmt(spendable(a))}. Pick a smaller amount or wait for more yield.`;
    case "CARD_FROZEN":
      return "Card is frozen.";
    case "CARD_NOT_ACTIVE":
      return "Activate your card first.";
  }
}

export function useVaultState() {
  const { isConnected, address } = useAccount();

  const [core, setCore] = useState<Core>(INITIAL_CORE);
  const coreRef = useRef<Core>(INITIAL_CORE);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [timeScale, setTimeScale] = useState<TimeScale>(1);
  const counter = useRef(0);
  // Engine-level mirror of the one-user-one-card rule (the verification server is the authority).

  /** Synchronous read-modify-write so callers always decide against the latest state. */
  const commit = useCallback((next: Core) => {
    coreRef.current = next;
    setCore(next);
  }, []);

  const record = useCallback((tx: Omit<Transaction, "id" | "timestamp" | "txHash" | "simulated" | "status">): Transaction => {
    counter.current += 1;
    const now = Date.now();
    const seed = `${tx.type}:${counter.current}:${tx.amountUsd}:${now}`;
    const full: Transaction = { ...tx, id: `tx-${counter.current}-${now}`, timestamp: now, txHash: simTxHash(seed), simulated: true, status: "confirmed" };
    setTransactions((prev) => [full, ...prev]);
    return full;
  }, []);

  const spendableUsd = spendable({ yieldUsd: core.yieldUsd });
  const card: CardDetails = useMemo(() => generateCardDetails(address ?? DEMO_SEED), [address]);

  // Real-time yield accrual (ticks every 250 ms; `timeScale` is a labelled demo accelerator).
  useEffect(() => {
    if (core.principalUsd <= 0) return;
    const id = setInterval(() => {
      const c = coreRef.current;
      const delta = yieldOver({ principalUsd: c.principalUsd, apyPercent: DEMO_APY }, 0.25 * timeScale);
      commit(fromAccount(c, accrueYield(toAccount(c), delta)));
    }, 250);
    return () => clearInterval(id);
  }, [core.principalUsd, timeScale, commit]);

  const deposit = useCallback(
    (amount: number): { success: boolean; error?: string } => {
      if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Enter a valid amount" };
      const c = coreRef.current;
      commit({ ...c, principalUsd: c.principalUsd + amount });
      record({ type: "deposit", title: `Deposited ${amount} USDC`, amountUsd: amount });
      return { success: true };
    },
    [commit, record],
  );

  const withdraw = useCallback(
    (amount: number): { success: boolean; error?: string } => {
      const c = coreRef.current;
      const check = checkWithdrawPrincipal(c, amount);
      if (!check.ok) return { success: false, error: check.reason };
      commit({ ...c, principalUsd: c.principalUsd - amount });
      record({ type: "withdraw", title: `Withdrew ${amount} USDC`, amountUsd: amount });
      return { success: true };
    },
    [commit, record],
  );

  const spendCard = useCallback(
    (amountUsd: number, merchant: string): SpendResult => {
      const c = coreRef.current;
      const d = authorizeCardSpend(toAccount(c), amountUsd);
      if (!d.ok) return { success: false, error: d.message, code: d.code };
      commit(fromAccount(c, d.next));
      const tx = record({ type: "card_spend", title: `Card Swipe - ${merchant}`, merchant, amountUsd, funding: d.funding });
      return {
        success: true,
        receipt: {
          authCode: authCode(tx.id),
          timestampIso: new Date(tx.timestamp).toISOString(),
          merchant,
          amountUsd,
          txHash: tx.txHash,
          funding: d.funding,
          source: "sandbox",
        },
        source: "sandbox",
      };
    },
    [commit, record],
  );

  const redeemVoucher = useCallback(
    (brand: VoucherBrandId, label: string, amountUsd: number): { success: boolean; voucherCode?: string; error?: string } => {
      const c = coreRef.current;
      const a = toAccount(c);
      const d = purchaseVoucher(a, amountUsd);
      if (!d.ok) return { success: false, error: friendly(d.code, a) };
      commit(fromAccount(c, d.next));
      const code = generateVoucherCode(brand, `${brand}:${counter.current + 1}:${Date.now()}`);
      record({ type: "voucher_redeem", title: `Gift Voucher - ${label} ($${amountUsd})`, merchant: label, amountUsd, voucherCode: code, funding: d.funding });
      return { success: true, voucherCode: code };
    },
    [commit, record],
  );

  const cashoutBank = useCallback(
    (amountUsd: number, rail: RailId, destination: string): { success: boolean; error?: string } => {
      const railInfo = RAILS.find((r) => r.id === rail);
      if (!railInfo) return { success: false, error: "Unknown payout rail" };
      const v = validateDestination(rail, destination);
      if (!v.ok) return { success: false, error: v.error };
      const c = coreRef.current;
      const a = toAccount(c);
      const d = cashOut(a, amountUsd);
      if (!d.ok) return { success: false, error: friendly(d.code, a) };
      commit(fromAccount(c, d.next));
      record({ type: "cashout", title: `Bank Transfer (${railInfo.name}) to ${maskDestination(rail, v.normalized)}`, amountUsd, rail: railInfo.name, funding: d.funding });
      return { success: true };
    },
    [commit, record],
  );

  const setIsCardFrozen = useCallback((frozen: boolean) => commit({ ...coreRef.current, frozen }), [commit]);
  const setMonthlyLimit = useCallback((limit: number) => commit({ ...coreRef.current, monthlyLimitUsd: limit }), [commit]);

  const resetToDemo = useCallback(() => {
    commit(INITIAL_CORE);
    setTransactions([]);
    setTimeScale(1);
  }, [commit]);

  return {
    isConnected,
    address,
    principalUsd: core.principalUsd,
    apyPercent: DEMO_APY,
    accruedYieldUsd: core.yieldUsd,
    spendableUsd,
    card,
    cardActive: core.cardActive,
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
    resetToDemo,
  };
}
