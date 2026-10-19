import type { Card, CardReadiness } from "./types";

/**
 * Where the user is in the card journey. The order is fixed by product rules:
 * phone verified (1 phone = 1 card) -> card provider session -> identity check (KYC) -> issue -> active.
 */
export type CardStage =
  | { stage: "no-wallet" }
  | { stage: "phone" }
  | { stage: "provider-login" }
  | { stage: "checking" }
  | { stage: "kyc"; kycUrl: string }
  | { stage: "pending" }
  | { stage: "funding" }
  | { stage: "issue" }
  | { stage: "active"; card: Card };

export interface StageInput {
  walletConnected: boolean;
  /** null while still asking the verification service. */
  phoneVerified: boolean | null;
  sessionActive: boolean;
  /** null until prerequisites have been read for this session. */
  readiness: CardReadiness | null;
  cards: Card[] | null;
}

export function deriveStage(i: StageInput): CardStage {
  if (!i.walletConnected) return { stage: "no-wallet" };
  if (i.phoneVerified === null) return { stage: "checking" };
  if (!i.phoneVerified) return { stage: "phone" };
  if (!i.sessionActive) return { stage: "provider-login" };
  if (i.cards === null || i.readiness === null) return { stage: "checking" };
  // An existing usable card wins: one account, one card. KYC state no longer matters once a card is active.
  const card = i.cards.find((c) => c.status === "active");
  if (card) return { stage: "active", card };
  switch (i.readiness.state) {
    case "kyc-required":
      return { stage: "kyc", kycUrl: i.readiness.kycUrl };
    case "pending":
      return { stage: "pending" };
    case "funding-required":
      return { stage: "funding" };
    case "ready":
      return { stage: "issue" };
  }
}

/** "203006" -> "06/30". Anything unexpected returns "••/••" rather than a wrong date. */
export function formatExpiry(yyyymm: string): string {
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(yyyymm);
  return m ? `${m[2]}/${m[1]!.slice(2)}` : "••/••";
}

/** "528854" + "1179" -> "5288 54•• •••• 1179" (16-digit Mastercard layout). */
export function maskedPan(first6: string, last4: string): string {
  if (!/^\d{6}$/.test(first6) || !/^\d{4}$/.test(last4)) return "•••• •••• •••• ••••";
  const a = first6 + "••••••";
  return `${a.slice(0, 4)} ${a.slice(4, 8)} •••• ${last4}`;
}

/** Group a revealed 16-digit PAN for display. Non-16-digit values are returned unchanged. */
export function groupPan(pan: string): string {
  return /^\d{16}$/.test(pan) ? pan.replace(/(\d{4})(?=\d)/g, "$1 ") : pan;
}

/**
 * The card's spend allowance in USD minor units (cents) is the user's available yield, rounded DOWN.
 * USDC has 6 decimals, so cents = base units / 10_000. Never rounds up, never negative.
 */
export function allowanceCents(yieldBaseUnits: bigint): number {
  if (yieldBaseUnits <= 0n) return 0;
  return Number(yieldBaseUnits / 10_000n);
}
