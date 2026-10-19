/**
 * Payout-rail validation for the off-ramp drawer. Validation is real (format + checksums);
 * the payout itself is SIMULATED, and FX rates are sandbox values.
 */

export type RailId = "upi" | "sepa" | "ach";

export interface Rail {
  id: RailId;
  name: string;
  currency: string;
  /** Sandbox FX rate: units of `currency` per 1 USD. */
  rate: number;
  placeholder: string;
}

export const RAILS: Rail[] = [
  { id: "upi", name: "UPI Instant (India)", currency: "INR", rate: 84.5, placeholder: "name@oksbi" },
  { id: "sepa", name: "SEPA Instant (EU)", currency: "EUR", rate: 0.92, placeholder: "DE89 3704 0044 0532 0130 00" },
  { id: "ach", name: "ACH (US)", currency: "USD", rate: 1, placeholder: "021000021 / 123456789" },
];

export type Validation = { ok: true; normalized: string } | { ok: false; error: string };

export function validateUpi(input: string): Validation {
  const v = input.trim();
  if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,31}$/.test(v)) {
    return { ok: false, error: "Enter a valid UPI ID, e.g. name@oksbi" };
  }
  return { ok: true, normalized: v.toLowerCase() };
}

const IBAN_LENGTHS: Record<string, number> = {
  AT: 20, BE: 16, BG: 22, HR: 21, CY: 28, CZ: 24, DK: 18, EE: 20, FI: 18, FR: 27, DE: 22, GR: 27, HU: 28,
  IE: 22, IT: 27, LV: 21, LT: 20, LU: 20, MT: 31, NL: 18, PL: 28, PT: 25, RO: 24, SK: 24, SI: 19, ES: 24,
  SE: 24, GB: 22, CH: 21, NO: 15, IS: 26,
};

function mod97(numeric: string): number {
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

export function validateIban(input: string): Validation {
  const v = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return { ok: false, error: "Enter a valid IBAN" };
  const expected = IBAN_LENGTHS[v.slice(0, 2)];
  if (expected === undefined) return { ok: false, error: `Country ${v.slice(0, 2)} is not supported for SEPA` };
  if (v.length !== expected) return { ok: false, error: `IBAN for ${v.slice(0, 2)} must be ${expected} characters` };
  const rearranged = v.slice(4) + v.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (mod97(numeric) !== 1) return { ok: false, error: "IBAN checksum is invalid" };
  return { ok: true, normalized: v.replace(/(.{4})/g, "$1 ").trim() };
}

export function validateRoutingNumber(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split("").map(Number) as number[];
  const sum = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!);
  return sum % 10 === 0;
}

/** Accepts "routing / account" separated by space, slash, dash or comma. */
export function validateAch(input: string): Validation {
  const parts = input.trim().split(/[\s/,\-]+/).filter(Boolean);
  if (parts.length !== 2) return { ok: false, error: "Enter routing and account number, e.g. 021000021 / 123456789" };
  const [routing, account] = parts as [string, string];
  if (!validateRoutingNumber(routing)) return { ok: false, error: "Routing number is invalid (9 digits with checksum)" };
  if (!/^\d{4,17}$/.test(account)) return { ok: false, error: "Account number must be 4-17 digits" };
  return { ok: true, normalized: `${routing} / ${account}` };
}

export function validateDestination(rail: RailId, input: string): Validation {
  if (rail === "upi") return validateUpi(input);
  if (rail === "sepa") return validateIban(input);
  return validateAch(input);
}

/** Show only the tail of a destination in the ledger. */
export function maskDestination(rail: RailId, normalized: string): string {
  if (rail === "upi") {
    const [user = "", host = ""] = normalized.split("@");
    return `${user.slice(0, 2)}***@${host}`;
  }
  return `••••${normalized.replace(/\D/g, "").slice(-4) || normalized.slice(-4)}`;
}
