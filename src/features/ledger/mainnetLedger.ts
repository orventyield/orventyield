import type { PoolEvent } from "../../lib/aave/position";
import { usdcBaseUnitsCeil } from "../../lib/vouchers/money";
import type { Transaction } from "../vault/useVaultState";

export interface LedgerVoucher {
  invoiceId: string;
  brand: string;
  face: string;
  priceUsdc: number;
  at: number;
}

const usd = (base: bigint) => Number(base) / 1_000_000;

/**
 * The Mainnet activity ledger, built only from things that really happened: Aave supply/withdraw events of the user's
 * Safe, plus the vouchers this browser bought. A yield withdrawal whose amount equals a voucher's price is shown as that
 * voucher (it IS the payment), not as two rows. Newest first.
 */
export interface LedgerCardTx {
  id: string;
  /** USD cents as the card network reports it. */
  amountCents: number;
  merchant: string;
  timestamp: number;
}

export function buildLedger(events: PoolEvent[], safe: string, vouchers: LedgerVoucher[], explorer?: string, cardTxs: LedgerCardTx[] = []): Transaction[] {
  const s = safe.toLowerCase();
  const unmatched = [...vouchers];
  const rows: Transaction[] = [];

  events.forEach((e, i) => {
    const link = explorer && e.txHash ? `${explorer}/tx/${e.txHash}` : undefined;
    const base = { id: `${e.txHash ?? "evt"}-${i}`, timestamp: e.timestamp ?? 0, txHash: e.txHash ?? "", simulated: false, status: "confirmed" as const, explorerUrl: link };
    if (e.kind === "supply") {
      if (e.counterparty.toLowerCase() === s) rows.push({ ...base, type: "deposit", title: "Deposited to Aave", amountUsd: usd(e.amount) });
      return;
    }
    if (e.counterparty.toLowerCase() === s) {
      // A yield withdrawal. If it paid a voucher, show it as the voucher.
      const v = unmatched.findIndex((x) => usdcBaseUnitsCeil(x.priceUsdc) === e.amount);
      if (v >= 0) {
        const [hit] = unmatched.splice(v, 1);
        rows.push({ ...base, type: "voucher_redeem", title: `${hit!.brand} voucher · ${hit!.face}`, amountUsd: usd(e.amount) });
      } else {
        rows.push({ ...base, type: "withdraw", title: "Yield withdrawn", amountUsd: usd(e.amount) });
      }
    } else {
      rows.push({ ...base, type: "withdraw", title: "Principal withdrawn", amountUsd: usd(e.amount) });
    }
  });

  // Vouchers whose payment is not in the loaded events yet (still confirming, or older than the loaded range).
  for (const v of unmatched) {
    rows.push({ id: `voucher-${v.invoiceId}`, type: "voucher_redeem", title: `${v.brand} voucher · ${v.face}`, amountUsd: v.priceUsdc, timestamp: v.at, txHash: "", simulated: false, status: "confirmed" });
  }
  // Real card payments as reported by the card network.
  for (const c of cardTxs) {
    rows.push({ id: `card-${c.id}`, type: "card_spend", title: `Card swipe - ${c.merchant}`, merchant: c.merchant, amountUsd: c.amountCents / 100, timestamp: c.timestamp, txHash: "", simulated: false, status: "confirmed", label: "Card network" });
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}
