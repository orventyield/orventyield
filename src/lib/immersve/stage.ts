import type { Card, CardReadiness } from "./types";

/**
 * Where the user is in the card journey. The order is fixed by product rules:
 * wallet signature (card provider sign-in) -> identity check (KYC) -> issue -> active. Funding the
 * card with yield is a separate step after that, not a stage of getting a card.
 */
export type CardStage =
  | { stage: "no-wallet" }
  | { stage: "provider-login" }
  | { stage: "checking" }
  | { stage: "kyc"; kycUrl: string }
  | { stage: "pending" }
  | { stage: "issue" }
  | { stage: "active"; card: Card };

export interface StageInput {
  walletConnected: boolean;
  sessionActive: boolean;
  /** null until prerequisites have been read for this session. */
  readiness: CardReadiness | null;
  cards: Card[] | null;
}

export function deriveStage(i: StageInput): CardStage {
  if (!i.walletConnected) return { stage: "no-wallet" };
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

