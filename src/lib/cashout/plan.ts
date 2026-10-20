import { getAddress, isAddress } from "viem";
import { baseToCents, planTopUp } from "../immersve/funding";
import { AWAITING, type SellOrder } from "./types";

/** Hard ceiling per cashout, in USDC, to limit the blast radius of any bug. */
export const MAX_CASHOUT_USDC = 500;
/** Transak's sell widget takes the USDC amount as a decimal number. We use whole cents. */
export const WIDGET_TOKEN = { cryptoCurrencyCode: "USDC", network: "arbitrum" } as const;

export interface CashoutPlan {
  cents: number;
  /** Exactly what leaves the Safe, in USDC base units. */
  base: bigint;
  /** Fixed amount for the widget (not editable there). */
  widgetAmount: number;
}

/**
 * How much to cash out: never more than the withdrawable EARNED YIELD, whole cents only, never above the ceiling.
 * `requestedCents` of null means "as much as the yield allows". Returns null when there is nothing to cash out.
 */
export function planCashout(maxYieldBase: bigint, requestedCents: number | null): CashoutPlan | null {
  // A request that is present but not a positive number is refused, never read as "as much as possible".
  if (requestedCents !== null && !(Number.isFinite(requestedCents) && requestedCents > 0)) return null;
  const plan = planTopUp(maxYieldBase, 0n, requestedCents === null ? null : Math.min(Math.floor(requestedCents), MAX_CASHOUT_USDC * 100));
  if (!plan) return null;
  const cents = Math.min(plan.cents, MAX_CASHOUT_USDC * 100);
  return { cents, base: BigInt(cents) * 10_000n, widgetAmount: cents / 100 };
}

export type OrderCheck = { ok: true; address: `0x${string}`; base: bigint } | { ok: false; reason: string };

/**
 * Decide whether an order is safe to pay. Every condition must hold, otherwise nothing is sent:
 * a SELL of USDC on Arbitrum, still awaiting our payment, to a valid address that is not one of our own contracts,
 * for EXACTLY the amount we planned (never more than the earned yield we locked in).
 */
export function checkOrderForPayment(order: SellOrder, plan: CashoutPlan, forbidden: readonly string[]): OrderCheck {
  if (order.side !== "SELL") return { ok: false, reason: "That order is not a cashout." };
  if (order.currency !== "USDC" || order.network !== "arbitrum") return { ok: false, reason: "That order uses a different coin or network than we asked for, so we stopped." };
  if (order.status !== AWAITING) return { ok: false, reason: "The order is not waiting for payment." };
  if (!order.depositAddress) return { ok: false, reason: "Transak has not given payment instructions we can verify yet. Nothing was sent." };
  if (!isAddress(order.depositAddress, { strict: true })) return { ok: false, reason: "The payment address looks wrong, so we stopped. Nothing was sent." };
  const address = getAddress(order.depositAddress);
  if (/^0x0{40}$/.test(address.toLowerCase())) return { ok: false, reason: "The payment address is empty. Nothing was sent." };
  if (forbidden.some((f) => f && f.toLowerCase() === address.toLowerCase())) return { ok: false, reason: "The payment address is not allowed. Nothing was sent." };
  if (!/^\d+(\.\d{1,6})?$/.test(order.cryptoAmount)) return { ok: false, reason: "The order amount is not valid. Nothing was sent." };
  const [w, f = ""] = order.cryptoAmount.split(".");
  const base = BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0"));
  if (base !== plan.base) return { ok: false, reason: "The order amount is different from what we asked for, so we stopped. Nothing was sent." };
  return { ok: true, address, base };
}

const ORDER_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Pull an order id out of a widget event payload. Only used to LOOK UP the order; the order itself comes from the server. */
export function orderIdFromEvent(data: unknown): string | null {
  const d = data as { id?: unknown; orderId?: unknown; status?: { id?: unknown } } | null;
  for (const c of [d?.id, d?.orderId, d?.status?.id]) if (typeof c === "string" && ORDER_ID.test(c)) return c;
  return null;
}

export const TRANSAK_ORIGINS = ["https://global.transak.com", "https://global-stg.transak.com"] as const;

/** Parse a window message from the Transak widget; null for anything that is not from the widget frame and origin. */
export function parseWidgetMessage(ev: { origin: string; source: unknown; data: unknown }, frame: unknown): { event: string; orderId: string | null } | null {
  if (!frame || ev.source !== frame) return null;
  if (!(TRANSAK_ORIGINS as readonly string[]).includes(ev.origin)) return null;
  const d = ev.data as { event_id?: unknown; data?: unknown } | null;
  if (!d || typeof d.event_id !== "string") return null;
  return { event: d.event_id, orderId: orderIdFromEvent(d.data) };
}

export { baseToCents };
