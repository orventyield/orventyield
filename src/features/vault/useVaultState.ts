"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useChainId } from "wagmi";
import {
  calculateAvailableLimit,
  calculateHealthFactor,
  getHealthStatus,
  calculateMicroBuffer,
  type HealthStatus,
} from "@/utils/math";

export interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "card_spend" | "voucher_redeem" | "yield_repay" | "cashout";
  title: string;
  merchant?: string;
  amountUsd: number;
  timestamp: number;
  txHash: string;
  status: "confirmed" | "pending";
  voucherCode?: string;
  rail?: string;
}

export interface TokenOption {
  symbol: "weETH" | "USDC" | "wstETH";
  name: string;
  priceUsd: number;
  apyPercent: number;
  maxLtv: number;
}

export const SUPPORTED_TOKENS = {
  weETH: {
    symbol: "weETH" as const,
    name: "Ether.fi weETH",
    priceUsd: 3450,
    apyPercent: 8.4,
    maxLtv: 0.75,
  },
  USDC: {
    symbol: "USDC" as const,
    name: "USD Coin",
    priceUsd: 1.0,
    apyPercent: 11.8,
    maxLtv: 0.85,
  },
  wstETH: {
    symbol: "wstETH" as const,
    name: "Lido wstETH",
    priceUsd: 3980,
    apyPercent: 3.6,
    maxLtv: 0.75,
  },
} satisfies Record<string, TokenOption>;

const INITIAL_DEMO_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-1",
    type: "deposit",
    title: "Initial Collateral Vault Deposit",
    amountUsd: 3450.0,
    timestamp: Date.now() - 86400000 * 3,
    txHash: "0x8fa3...c4e1",
    status: "confirmed",
  },
  {
    id: "tx-2",
    type: "card_spend",
    title: "Card Swipe - Starbucks Coffee",
    merchant: "Starbucks",
    amountUsd: 4.85,
    timestamp: Date.now() - 86400000 * 1.5,
    txHash: "0x1b2c...e890",
    status: "confirmed",
  },
  {
    id: "tx-3",
    type: "voucher_redeem",
    title: "Gift Voucher - Amazon Prime",
    merchant: "Amazon",
    amountUsd: 25.0,
    timestamp: Date.now() - 86400000 * 0.8,
    txHash: "0x3e4f...11a2",
    status: "confirmed",
    voucherCode: "AMZN-YLD-9281-KX92",
  },
];

export function useVaultState() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();

  // Selected collateral asset
  const [selectedToken, setSelectedToken] = useState<TokenOption>(SUPPORTED_TOKENS.weETH);

  // Vault balances
  const [collateralAmount, setCollateralAmount] = useState<number>(2.0); // 2 weETH = $6,900 default demo
  const [activeDebtUsd, setActiveDebtUsd] = useState<number>(350.0);
  const [accruedYieldUsd, setAccruedYieldUsd] = useState<number>(48.25);

  // Card Controls
  const [isCardFrozen, setIsCardFrozen] = useState<boolean>(false);
  const [monthlyLimit, setMonthlyLimit] = useState<number>(1500);
  const [isSandboxMode, setIsSandboxMode] = useState<boolean>(true); // default true for $0 cost interactive exploration

  // Transactions Ledger
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_DEMO_TRANSACTIONS);

  // Derived financial computations
  const collateralUsd = collateralAmount * selectedToken.priceUsd;
  const availableLimit = calculateAvailableLimit(collateralUsd, activeDebtUsd, selectedToken.maxLtv);
  const healthFactor = calculateHealthFactor(collateralUsd, activeDebtUsd, selectedToken.maxLtv);
  const healthStatus: HealthStatus = getHealthStatus(healthFactor);
  const microBuffer = calculateMicroBuffer(collateralUsd, selectedToken.apyPercent, 7);

  // Spent this month sum
  const spentThisMonth = transactions
    .filter((tx) => tx.type === "card_spend" || tx.type === "voucher_redeem" || tx.type === "cashout")
    .reduce((sum, tx) => sum + tx.amountUsd, 0);

  // Real-time continuous yield accrual ticking
  useEffect(() => {
    if (collateralUsd <= 0) return;

    const interval = setInterval(() => {
      // Yield accrued every 250ms = (collateralUsd * (APY/100) * (0.25 / 31536000))
      const deltaYield = (collateralUsd * (selectedToken.apyPercent / 100) * 0.25) / 31536000;
      setAccruedYieldUsd((prev) => prev + deltaYield);
    }, 250);

    return () => clearInterval(interval);
  }, [collateralUsd, selectedToken.apyPercent]);

  // Actions
  const deposit = useCallback((amount: number) => {
    if (amount <= 0) return;
    setCollateralAmount((prev) => prev + amount);
    const newTx: Transaction = {
      id: "tx-" + Date.now(),
      type: "deposit",
      title: `Deposited ${amount} ${selectedToken.symbol}`,
      amountUsd: amount * selectedToken.priceUsd,
      timestamp: Date.now(),
      txHash: "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6),
      status: "confirmed",
    };
    setTransactions((prev) => [newTx, ...prev]);
  }, [selectedToken]);

  const withdraw = useCallback((amount: number): { success: boolean; error?: string } => {
    if (amount <= 0) return { success: false, error: "Invalid amount" };
    if (amount > collateralAmount) return { success: false, error: "Insufficient collateral balance" };

    const newCollateral = collateralAmount - amount;
    const newCollateralUsd = newCollateral * selectedToken.priceUsd;
    const newHf = calculateHealthFactor(newCollateralUsd, activeDebtUsd, selectedToken.maxLtv);

    if (activeDebtUsd > 0 && newHf < 1.2) {
      return {
        success: false,
        error: `Withdrawal rejected: Health Factor would drop to ${newHf.toFixed(2)}x (minimum safe threshold is 1.20x). Repay some debt first!`,
      };
    }

    setCollateralAmount(newCollateral);
    const newTx: Transaction = {
      id: "tx-" + Date.now(),
      type: "withdraw",
      title: `Withdrew ${amount} ${selectedToken.symbol}`,
      amountUsd: amount * selectedToken.priceUsd,
      timestamp: Date.now(),
      txHash: "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6),
      status: "confirmed",
    };
    setTransactions((prev) => [newTx, ...prev]);
    return { success: true };
  }, [collateralAmount, selectedToken, activeDebtUsd]);

  const spendCard = useCallback(
    (amountUsd: number, merchant: string): { success: boolean; error?: string; tx?: Transaction } => {
      if (amountUsd <= 0) return { success: false, error: "Amount must be greater than $0" };
      if (isCardFrozen) return { success: false, error: "Transaction declined: Card is currently frozen" };
      if (spentThisMonth + amountUsd > monthlyLimit) {
        return {
          success: false,
          error: `Transaction declined: Exceeds monthly card spend limit of $${monthlyLimit.toLocaleString()}`,
        };
      }

      // Check available limit + micro buffer
      const totalCapacity = availableLimit + microBuffer;
      if (amountUsd > totalCapacity) {
        return {
          success: false,
          error: `Insufficient limit. Available: $${availableLimit.toFixed(2)} + $${microBuffer.toFixed(2)} buffer`,
        };
      }

      // Simulate execution
      setActiveDebtUsd((prev) => prev + amountUsd);
      const newTx: Transaction = {
        id: "tx-" + Date.now(),
        type: "card_spend",
        title: `Card Swipe - ${merchant}`,
        merchant,
        amountUsd,
        timestamp: Date.now(),
        txHash: "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6),
        status: "confirmed",
      };
      setTransactions((prev) => [newTx, ...prev]);
      return { success: true, tx: newTx };
    },
    [isCardFrozen, spentThisMonth, monthlyLimit, availableLimit, microBuffer]
  );

  const redeemVoucher = useCallback(
    (brand: string, amountUsd: number, useYield: boolean): { success: boolean; voucherCode?: string; error?: string } => {
      if (amountUsd <= 0) return { success: false, error: "Invalid voucher amount" };

      if (useYield) {
        if (accruedYieldUsd < amountUsd) {
          return {
            success: false,
            error: `Insufficient accrued yield ($${accruedYieldUsd.toFixed(2)} available). Choose a smaller voucher or switch to Credit Line.`,
          };
        }
        setAccruedYieldUsd((prev) => prev - amountUsd);
      } else {
        if (amountUsd > availableLimit) {
          return {
            success: false,
            error: `Insufficient credit limit ($${availableLimit.toFixed(2)} available).`,
          };
        }
        setActiveDebtUsd((prev) => prev + amountUsd);
      }

      const randomCode = `${brand.slice(0, 4).toUpperCase()}-YLD-${Math.floor(1000 + Math.random() * 9000)}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      const newTx: Transaction = {
        id: "tx-" + Date.now(),
        type: "voucher_redeem",
        title: `Gift Voucher - ${brand} ($${amountUsd})`,
        merchant: brand,
        amountUsd,
        timestamp: Date.now(),
        txHash: "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6),
        status: "confirmed",
        voucherCode: randomCode,
      };

      setTransactions((prev) => [newTx, ...prev]);
      return { success: true, voucherCode: randomCode };
    },
    [accruedYieldUsd, availableLimit]
  );

  const cashoutBank = useCallback(
    (amountUsd: number, rail: string, identifier: string): { success: boolean; error?: string } => {
      if (amountUsd <= 0) return { success: false, error: "Amount must be greater than $0" };
      if (amountUsd > accruedYieldUsd + availableLimit) {
        return { success: false, error: "Insufficient available yield or credit limit" };
      }

      // Prioritize paying from accrued yield first, then credit limit
      if (accruedYieldUsd >= amountUsd) {
        setAccruedYieldUsd((prev) => prev - amountUsd);
      } else {
        const creditUsed = amountUsd - accruedYieldUsd;
        setAccruedYieldUsd(0);
        setActiveDebtUsd((prev) => prev + creditUsed);
      }

      const newTx: Transaction = {
        id: "tx-" + Date.now(),
        type: "cashout",
        title: `Bank Transfer (${rail}) to ${identifier.slice(0, 4)}***`,
        amountUsd,
        timestamp: Date.now(),
        txHash: "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6),
        status: "confirmed",
        rail,
      };

      setTransactions((prev) => [newTx, ...prev]);
      return { success: true };
    },
    [accruedYieldUsd, availableLimit]
  );

  const repayDebtWithYield = useCallback((): { success: boolean; repaidAmount: number } => {
    if (activeDebtUsd <= 0 || accruedYieldUsd <= 0) return { success: false, repaidAmount: 0 };

    const repayAmount = Math.min(activeDebtUsd, accruedYieldUsd);
    setActiveDebtUsd((prev) => Math.max(0, prev - repayAmount));
    setAccruedYieldUsd((prev) => Math.max(0, prev - repayAmount));

    const newTx: Transaction = {
      id: "tx-" + Date.now(),
      type: "yield_repay",
      title: `Auto-Repayed Debt with Accrued Yield`,
      amountUsd: repayAmount,
      timestamp: Date.now(),
      txHash: "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6),
      status: "confirmed",
    };
    setTransactions((prev) => [newTx, ...prev]);
    return { success: true, repaidAmount: repayAmount };
  }, [activeDebtUsd, accruedYieldUsd]);

  const resetToDemo = useCallback(() => {
    setSelectedToken(SUPPORTED_TOKENS.weETH);
    setCollateralAmount(2.0);
    setActiveDebtUsd(350.0);
    setAccruedYieldUsd(48.25);
    setIsCardFrozen(false);
    setMonthlyLimit(1500);
    setTransactions(INITIAL_DEMO_TRANSACTIONS);
  }, []);

  return {
    isConnected,
    address,
    chainId,
    isSandboxMode,
    setIsSandboxMode,
    selectedToken,
    setSelectedToken,
    collateralAmount,
    collateralUsd,
    activeDebtUsd,
    accruedYieldUsd,
    availableLimit,
    healthFactor,
    healthStatus,
    microBuffer,
    isCardFrozen,
    setIsCardFrozen,
    monthlyLimit,
    setMonthlyLimit,
    spentThisMonth,
    transactions,
    deposit,
    withdraw,
    spendCard,
    redeemVoucher,
    cashoutBank,
    repayDebtWithYield,
    resetToDemo,
  };
}
