/** Bank / UPI cashout through Transak's SELL widget. Only EARNED YIELD is ever cashed out; principal is never touched. */

/** What the Worker returns for a Transak sell order, already normalised and validated server-side. */
export interface SellOrder {
  id: string;
  /** Transak status, e.g. AWAITING_PAYMENT_FROM_USER, COMPLETED. */
  status: string;
  side: string;
  /** Decimal string as Transak reports it, e.g. "1.87". */
  cryptoAmount: string;
  currency: string;
  network: string;
  /** Where the USDC must be sent. null until the operator has confirmed which order field carries it (see worker/transak.ts). */
  depositAddress: string | null;
  fiatAmount?: number;
  fiatCurrency?: string;
}

export interface CashoutSession {
  /** Single-use widget URL (valid for 5 minutes). */
  widgetUrl: string;
}

/** Statuses that mean "Transak is waiting for our USDC". */
export const AWAITING = "AWAITING_PAYMENT_FROM_USER";
export const DONE_STATUSES = new Set(["COMPLETED"]);
export const FAILED_STATUSES = new Set(["CANCELLED", "FAILED", "EXPIRED", "REFUNDED"]);
