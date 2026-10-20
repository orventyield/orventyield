/**
 * One user = one card (1U1C): the pure rule. The server enforces it with UNIQUE constraints; the Playground and the
 * spend engine use this same function, so the rule has a single definition.
 *
 * - a verified phone is bound to exactly one owner (wallet or guest id) at a time;
 * - an owner can hold exactly one card, bound to one phone;
 * - repeating the same (owner, phone) pair is a no-op, so re-activating on a new device works;
 * - a phone that proves it is yours (OTP) can be RE-LINKED to a new owner that has no card: the binding MOVES, so there is
 *   still exactly one active holder per phone. This is how a returning user signs in on a new wallet or device.
 */
export type ClaimRejection = "PHONE_ALREADY_BOUND" | "OWNER_ALREADY_HAS_CARD";

export const CLAIM_MESSAGES: Record<ClaimRejection, string> = {
  PHONE_ALREADY_BOUND: "Card already active for this verified identity.",
  OWNER_ALREADY_HAS_CARD: "This account already has an active card.",
};

export interface CardRegistry {
  /** phone hash -> owner */
  byPhone: Readonly<Record<string, string>>;
  /** owner -> phone hash */
  byOwner: Readonly<Record<string, string>>;
}

export const emptyRegistry = (): CardRegistry => ({ byPhone: {}, byOwner: {} });

/** Wallet addresses are case-insensitive; everything else is compared as given. */
export const normalizeOwner = (owner: string): string => (/^0x[0-9a-fA-F]{40}$/.test(owner) ? owner.toLowerCase() : owner);

export type ClaimResult =
  | { ok: true; registry: CardRegistry; idempotent: boolean; /** The owner the binding moved away from, when this was a re-link. */ relinkedFrom?: string }
  | { ok: false; code: ClaimRejection; message: string; registry: CardRegistry };

export function claimCard(registry: CardRegistry, ownerRaw: string, phoneHash: string): ClaimResult {
  const owner = normalizeOwner(ownerRaw);
  const boundTo = registry.byPhone[phoneHash];
  const ownerPhone = registry.byOwner[owner];

  if (boundTo === owner && ownerPhone === phoneHash) return { ok: true, registry, idempotent: true };
  // This owner already holds a card for a different phone: one card per account, whatever the phone.
  if (ownerPhone !== undefined) return { ok: false, code: "OWNER_ALREADY_HAS_CARD", message: CLAIM_MESSAGES.OWNER_ALREADY_HAS_CARD, registry };
  if (boundTo !== undefined) {
    // Re-link: move the binding to this owner. The previous owner no longer holds the card.
    const byOwner = { ...registry.byOwner };
    delete byOwner[boundTo];
    byOwner[owner] = phoneHash;
    return { ok: true, idempotent: false, relinkedFrom: boundTo, registry: { byPhone: { ...registry.byPhone, [phoneHash]: owner }, byOwner } };
  }
  return {
    ok: true,
    idempotent: false,
    registry: { byPhone: { ...registry.byPhone, [phoneHash]: owner }, byOwner: { ...registry.byOwner, [owner]: phoneHash } },
  };
}

export const hasCard = (registry: CardRegistry, owner: string): boolean => normalizeOwner(owner) in registry.byOwner;
