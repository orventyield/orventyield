/**
 * "Link your card": the user gets a card from a third-party provider (their KYC, their card), copies that card's USDC/USDG
 * deposit address, and links it here. OrventYield never issues, holds or sees the card; it only sends the user's own yield
 * (or, by explicit choice, principal) from the user's Safe to that address, on the chain and token the provider accepts.
 *
 * Everything that decides whether money may move is a pure function in this file, so it is unit tested:
 *  - which address is acceptable (validateCardAddress),
 *  - what a saved record must look like to be trusted again (parseLinkedCards),
 *  - the order of steps (linked -> test sent -> verified) and what each step allows (checkCardSend).
 */
import { getAddress, isAddress, type Address } from "viem";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "../contracts/arbitrum";
import { ROBINHOOD, ROBINHOOD_CHAIN_ID } from "../contracts/robinhood";

export type CardNetwork = "arbitrum" | "robinhood";
export type ProviderId = "redotpay" | "solcard";
export type CardStatus = "linked" | "test-sent" | "verified";
export type CardSource = "yield" | "principal";

export interface CardProvider {
  id: ProviderId;
  name: string;
  network: CardNetwork;
  chainId: number;
  chainName: string;
  token: "USDC" | "USDG";
  /** Plain link to the provider's own site: no referral, affiliate or tracking parameters. */
  siteUrl: string;
  steps: string[];
  caution: string;
}

const SHARED_CAUTION =
  "OrventYield is not affiliated with this provider and never issues, holds or sees your card. Money you send is held by the provider under its own terms. Check its fees, limits and whether it is available in your country before you add money.";

export const CARD_PROVIDERS: readonly CardProvider[] = [
  {
    id: "redotpay",
    name: "RedotPay",
    network: "arbitrum",
    chainId: ARBITRUM_CHAIN_ID,
    chainName: "Arbitrum One",
    token: "USDC",
    siteUrl: "https://www.redotpay.com",
    steps: [
      "Open RedotPay, sign up and finish its identity check. RedotPay does this, not OrventYield.",
      "Create your virtual card in the RedotPay app.",
      "In the app, open Deposit, choose USDC and the Arbitrum One network, and copy the deposit address it shows.",
      "Come back here and paste that address.",
    ],
    caution: SHARED_CAUTION,
  },
  {
    id: "solcard",
    name: "SolCard",
    network: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    chainName: "Robinhood Chain",
    token: "USDG",
    siteUrl: "https://www.solcard.cc",
    steps: [
      "Open SolCard, sign up and finish its identity check. SolCard does this, not OrventYield.",
      "Create your card in the SolCard app.",
      "In the app, open Deposit, choose USDG and the Robinhood Chain network, and copy the deposit address it shows.",
      "Come back here and paste that address.",
    ],
    caution: `${SHARED_CAUTION} SolCard's support for USDG on Robinhood Chain comes from its own announcement: confirm the network name in its app before you send anything.`,
  },
];

export const providerFor = (network: CardNetwork): CardProvider => CARD_PROVIDERS.find((p) => p.network === network)!;
export const providerById = (id: string): CardProvider | undefined => CARD_PROVIDERS.find((p) => p.id === id);

/** The test send: exactly $1.00 (6-decimal USDC/USDG base units). Nothing larger is allowed until the user has seen it arrive. */
export const TEST_SEND = 1_000_000n;

/** Contracts that must never be a card deposit address: a transfer there would be lost or would hit our own flow. */
export function protocolAddresses(network: CardNetwork): Address[] {
  const safe = [ARBITRUM.safeProxyFactory, ARBITRUM.safeL2Singleton, ARBITRUM.safeFallbackHandler, ARBITRUM.safeMultiSendCallOnly];
  return network === "arbitrum"
    ? [ARBITRUM.usdc, ARBITRUM.aavePool, ...safe]
    : [ROBINHOOD.usdg, ROBINHOOD.steakhouseUsdgVault, ROBINHOOD.morphoBlue, ROBINHOOD.safeProxyFactory, ROBINHOOD.safeL2Singleton, ROBINHOOD.safeFallbackHandler, ROBINHOOD.safeMultiSendCallOnly];
}

const BURN = ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"];

export type AddressCheck = { ok: true; address: Address } | { ok: false; reason: string };

export interface AddressContext {
  network: CardNetwork;
  /** The user's own wallet and Safe (any may be undefined while loading). Sending a "card top-up" to these is a mistake. */
  own: readonly (string | undefined)[];
}

/** Refuse anything that is not a plausible, safe card deposit address on this chain. Returns the checksummed address. */
export function validateCardAddress(input: string, ctx: AddressContext): AddressCheck {
  const v = input.trim();
  if (!v) return { ok: false, reason: "Paste the deposit address from your card app." };
  if (/\s/.test(v)) return { ok: false, reason: "Remove the spaces from the address." };
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    return { ok: false, reason: "That is not an EVM address. It must start with 0x and be 42 characters long. Tron, Solana and Bitcoin addresses will not work here." };
  }
  // A mixed-case address carries a checksum: if it does not match, a character was mistyped or mis-copied.
  if (!isAddress(v, { strict: true })) return { ok: false, reason: "That address has a typo (its capital letters do not match). Copy it again from your card app." };
  const address = getAddress(v);
  const lower = address.toLowerCase();
  if (BURN.includes(lower)) return { ok: false, reason: "That is not a real deposit address." };
  if (ctx.own.some((o) => o && o.toLowerCase() === lower)) return { ok: false, reason: "That is your own wallet or Safe, not a card deposit address." };
  if (protocolAddresses(ctx.network).some((p) => p.toLowerCase() === lower)) return { ok: false, reason: "That is a token or protocol contract, not a card deposit address." };
  return { ok: true, address };
}

export interface LinkedCard {
  provider: ProviderId;
  network: CardNetwork;
  token: "USDC" | "USDG";
  address: Address;
  status: CardStatus;
  linkedAt: number;
}

const STATUSES: readonly CardStatus[] = ["linked", "test-sent", "verified"];

/**
 * Read saved cards back from storage. Nothing in storage is trusted: every record is re-checked (known provider, matching chain
 * and token, a valid status, an address that passes validateCardAddress), and one card per provider is kept. Bad records are dropped.
 */
export function parseLinkedCards(raw: string | null, own: readonly (string | undefined)[]): LinkedCard[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: LinkedCard[] = [];
  for (const r of data) {
    const rec = r as Partial<LinkedCard> | null;
    const p = typeof rec?.provider === "string" ? providerById(rec.provider) : undefined;
    if (!rec || !p || rec.network !== p.network || rec.token !== p.token) continue;
    if (!STATUSES.includes(rec.status as CardStatus) || typeof rec.address !== "string") continue;
    const ok = validateCardAddress(rec.address, { network: p.network, own });
    if (!ok.ok || out.some((c) => c.provider === p.id)) continue;
    out.push({ provider: p.id, network: p.network, token: p.token, address: ok.address, status: rec.status as CardStatus, linkedAt: typeof rec.linkedAt === "number" ? rec.linkedAt : 0 });
  }
  return out;
}

/** Link (or replace) the user's card for a provider. A new or changed address always starts again at "linked": it must be tested. */
export function linkCard(list: readonly LinkedCard[], provider: CardProvider, address: Address, now: number): LinkedCard[] {
  return [...list.filter((c) => c.provider !== provider.id), { provider: provider.id, network: provider.network, token: provider.token, address, status: "linked", linkedAt: now }];
}

/** The $1 test went out. Only a card that is still being tested can move to "test-sent". */
export function markTestSent(list: readonly LinkedCard[], id: ProviderId): LinkedCard[] {
  return list.map((c) => (c.provider === id && c.status !== "verified" ? { ...c, status: "test-sent" as const } : c));
}

/** The user saw the test arrive in the card app. Only possible after a test was sent. */
export function markVerified(list: readonly LinkedCard[], id: ProviderId): LinkedCard[] {
  return list.map((c) => (c.provider === id && c.status === "test-sent" ? { ...c, status: "verified" as const } : c));
}

export const unlinkCard = (list: readonly LinkedCard[], id: ProviderId): LinkedCard[] => list.filter((c) => c.provider !== id);

export type SendKind = "test" | "add";
export type SendCheck = { ok: true } | { ok: false; reason: string };

/**
 * May this amount go to this card right now? "test" is exactly $1.00 and only before verification; "add" needs a verified card.
 * `limit` is what the chosen source can release (withdrawable yield, or deposited principal). Never reduced silently: refused.
 */
export function checkCardSend(card: Pick<LinkedCard, "status" | "token">, kind: SendKind, source: CardSource, amount: bigint, limit: bigint): SendCheck {
  if (amount <= 0n) return { ok: false, reason: "Enter an amount greater than zero." };
  if (kind === "test") {
    if (card.status === "verified") return { ok: false, reason: "This card is already verified." };
    if (amount !== TEST_SEND) return { ok: false, reason: "The test send is exactly $1.00." };
    if (limit < TEST_SEND) return { ok: false, reason: source === "yield" ? `You need at least $1.00 of earned ${card.token} yield for the test, or choose principal.` : `You need at least $1.00 of ${card.token} principal for the test.` };
    return { ok: true };
  }
  if (card.status !== "verified") return { ok: false, reason: "Send the $1 test and confirm it arrived before adding more." };
  if (amount > limit) return { ok: false, reason: source === "yield" ? "That is more than the yield you have earned. Your principal stays locked." : "That is more than your deposited principal." };
  return { ok: true };
}

export const storageKey = (owner: string): string => `oy.linkedcards.v1.${owner.toLowerCase()}`;
