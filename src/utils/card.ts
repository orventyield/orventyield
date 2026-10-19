/**
 * Demo card, voucher code and simulated transaction-hash helpers.
 * Everything here is SIMULATED: the card is not issued, vouchers are not redeemable and hashes are
 * not on-chain. All values are derived deterministically from a seed so they are testable.
 */
import { keccak256, stringToBytes } from "viem";

export type CardNetwork = "visa" | "mastercard";

export interface CardDetails {
  /** 16 digits, no spaces. Luhn-valid. */
  pan: string;
  cvv: string;
  /** MM/YY */
  expiry: string;
  network: CardNetwork;
}

function hashBytes(seed: string): number[] {
  const hex = keccak256(stringToBytes(seed)).slice(2);
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Luhn check digit that makes `partial` + digit pass validation. */
export function luhnCheckDigit(partial: string): number {
  let sum = 0;
  // Walk right-to-left over the partial; the (future) check digit sits at position 0, so the first
  // partial digit is doubled.
  for (let i = partial.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(partial[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isLuhnValid(pan: string): boolean {
  if (!/^\d{12,19}$/.test(pan)) return false;
  return luhnCheckDigit(pan.slice(0, -1)) === Number(pan.slice(-1));
}

export function detectNetwork(pan: string): CardNetwork | null {
  if (/^4/.test(pan)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(pan)) return "mastercard";
  return null;
}

/** Card expires at the end of the month, 4 years after `now`. */
export function cardExpiry(now: Date): string {
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const yy = String((now.getUTCFullYear() + 4) % 100).padStart(2, "0");
  return `${mm}/${yy}`;
}

export function generateCardDetails(seed: string, now: Date = new Date()): CardDetails {
  const b = hashBytes(`card:${seed}`);
  const network: CardNetwork = (b[0] ?? 0) % 2 === 0 ? "visa" : "mastercard";
  // Fixed demo BINs (4000 00 / 5555 55) followed by 9 hash-derived digits and a Luhn check digit.
  const prefix = network === "visa" ? "400000" : "555555";
  let body = prefix;
  for (let i = 1; body.length < 15; i++) body += String((b[i] ?? 0) % 10);
  const pan = body + luhnCheckDigit(body);
  const cvv = [20, 21, 22].map((i) => String((b[i] ?? 0) % 10)).join("");
  return { pan, cvv, expiry: cardExpiry(now), network };
}

export function formatPan(pan: string, reveal: boolean): string {
  const groups = pan.match(/.{1,4}/g) ?? [];
  return groups.map((g, i) => (reveal || i === groups.length - 1 ? g : "••••")).join(" ");
}

export const VOUCHER_BRANDS = {
  amazon: "AMZN",
  uber: "UBER",
  swiggy: "SWGY",
  apple: "APPL",
  steam: "STEA",
} as const;
export type VoucherBrandId = keyof typeof VOUCHER_BRANDS;

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. AMZN-YLD-8942-X7F1. Demo only: not redeemable anywhere. */
export function generateVoucherCode(brand: VoucherBrandId, seed: string): string {
  const b = hashBytes(`voucher:${brand}:${seed}`);
  const digits = [0, 1, 2, 3].map((i) => String((b[i] ?? 0) % 10)).join("");
  const tail = [4, 5, 6, 7].map((i) => ALNUM[(b[i] ?? 0) % ALNUM.length]).join("");
  return `${VOUCHER_BRANDS[brand]}-YLD-${digits}-${tail}`;
}

/** 32-byte simulated transaction hash. Not on-chain. */
export function simTxHash(seed: string): `0x${string}` {
  return keccak256(stringToBytes(`tx:${seed}`));
}

export function shortHash(h: string): string {
  return h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}

/** 6-digit authorization code, e.g. "482913". */
export function authCode(seed: string): string {
  const b = hashBytes(`auth:${seed}`);
  return [0, 1, 2, 3, 4, 5].map((i) => String((b[i] ?? 0) % 10)).join("");
}
