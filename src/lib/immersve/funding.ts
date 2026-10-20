import { encodeFunctionData, getAddress, isAddress, type Abi, type Hex } from "viem";
import type { FundingChannel, ImmersveConfig, Prerequisite, WithdrawalIntent } from "./types";

/**
 * Card funding, from Immersve's docs (Card Funding, Funding Types, Monetary Units) and the sandbox:
 *  - a card only authorizes against its Funding Source balance;
 *  - money values are integer minor units: USD cents, and USDC base units (6 decimals), so 1 cent = 10_000 base units;
 *  - Get Spending Prerequisites returns a funding action when the balance is short. Sandbox: `simulator_call`. Production
 *    Universal EVM: a contract write whose exact shape is NOT in the public docs, so we do not parse it;
 *  - deposit mode: the depositor sends an ERC-20 transfer to the channel's Funds Storage address and the Funding Source
 *    is credited after confirmation. The funding wallet may be an EOA or an ERC-1271 smart contract (our Safe).
 */

export const BASE_UNITS_PER_CENT = 10_000n;

/** USDC base units -> whole USD cents, rounded DOWN. */
export const baseToCents = (base: bigint): number => (base <= 0n ? 0 : Number(base / BASE_UNITS_PER_CENT));

/** USD cents -> USDC base units, exact. */
export const centsToBase = (cents: number): bigint => (Number.isInteger(cents) && cents > 0 ? BigInt(cents) * BASE_UNITS_PER_CENT : 0n);

export type FundingAction =
  | { kind: "funded" }
  | { kind: "simulator"; url: string; payload: { amount: string; fundingSourceId: string } }
  | { kind: "onchain"; actionType: string }
  | { kind: "unsupported"; actionType: string };

/** Read the funding stage of the spending prerequisites. Unknown shapes become `unsupported`, never a guess. */
export function fundingAction(prereqs: Prerequisite[]): FundingAction {
  const f = prereqs.find((p) => p.stage === "funding");
  if (!f || f.status === "ok") return { kind: "funded" };
  const type = String((f as { type?: unknown }).type ?? f.actionType ?? "");
  if (type === "simulator_call") {
    const params = (f.params ?? {}) as { url?: unknown; payload?: { amount?: unknown; fundingSourceId?: unknown } };
    const { url, payload } = params;
    if (typeof url === "string" && typeof payload?.amount === "string" && typeof payload.fundingSourceId === "string") {
      return { kind: "simulator", url, payload: { amount: payload.amount, fundingSourceId: payload.fundingSourceId } };
    }
    return { kind: "unsupported", actionType: type };
  }
  if (type === "smart_contract_write" || type === "smart-contract-write") return { kind: "onchain", actionType: type };
  return { kind: "unsupported", actionType: type || "unknown" };
}

export interface TopUpPlan {
  /** Cents to add to the card balance. */
  cents: number;
  /** Exactly that many USDC base units: this is what leaves the Safe. */
  base: bigint;
  /** The balance the funding source must reach, in cents (what we ask prerequisites for). */
  targetCents: number;
}

/**
 * How much to put on the card. Never more than the earned yield that can be withdrawn, whole cents only, and never
 * negative. `requestedCents` of null means "as much as the yield allows".
 */
export function planTopUp(maxYieldBase: bigint, balanceBase: bigint, requestedCents: number | null): TopUpPlan | null {
  const maxCents = baseToCents(maxYieldBase);
  const cents = requestedCents === null ? maxCents : Math.min(Math.floor(requestedCents), maxCents);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return { cents, base: centsToBase(cents), targetCents: baseToCents(balanceBase) + cents };
}

/** Where card top-up money comes from. Yield is the default; principal is an explicit, separate choice. */
export type TopUpSource = "yield" | "principal";

export type TopUpRequestCheck = { ok: true; cents: number } | { ok: false; reason: string };

/**
 * Refuse (never silently shrink) a top-up the chosen source cannot cover. `limitBase` is what that source may release in
 * USDC base units: withdrawable yield, or the deposited principal. Whole cents only; zero, negative and NaN are rejected.
 */
export function checkTopUpRequest(source: TopUpSource, requestedCents: number, limitBase: bigint): TopUpRequestCheck {
  if (!Number.isInteger(requestedCents) || requestedCents <= 0) return { ok: false, reason: "Enter an amount of at least $0.01." };
  if (centsToBase(requestedCents) > limitBase) {
    return {
      ok: false,
      reason: source === "yield" ? "That is more than the yield you have earned. Your principal stays locked." : "That is more than your deposited principal.",
    };
  }
  return { ok: true, cents: requestedCents };
}

export type StorageCheck = { ok: true; address: `0x${string}` } | { ok: false; reason: string };

/**
 * The address deposits go to. It comes from the funding channel and, when configured, must equal the pinned address.
 * We refuse anything malformed, the zero address, or one of our own contracts (a deposit there would be lost).
 */
export function fundsStorageFor(channel: FundingChannel, cfg: Pick<ImmersveConfig, "fundsStorageAddress">, forbidden: readonly string[]): StorageCheck {
  const raw = channel.params?.storageAddress;
  if (typeof raw !== "string" || !isAddress(raw, { strict: true })) return { ok: false, reason: "The card issuer did not give a valid funds address." };
  const address = getAddress(raw);
  if (/^0x0{40}$/.test(address.toLowerCase())) return { ok: false, reason: "The funds address is empty." };
  if (cfg.fundsStorageAddress && getAddress(cfg.fundsStorageAddress) !== address) {
    return { ok: false, reason: "The funds address does not match the one we expect, so we stopped. Nothing was sent." };
  }
  if (forbidden.some((f) => f.toLowerCase() === address.toLowerCase())) return { ok: false, reason: "The funds address is not allowed." };
  return { ok: true, address };
}

/** Only ever send the bearer token to the issuer's own API host. */
export function sameApiHost(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(baseUrl);
    return a.protocol === "https:" && a.host === b.host;
  } catch {
    return false;
  }
}

export type WithdrawalAction =
  | { kind: "simulator"; url: string; payload: Record<string, unknown> }
  | { kind: "onchain"; to: `0x${string}`; data: Hex }
  | { kind: "unsupported"; reason: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Turn a withdrawal intent's `execution` into something we can run. Sandbox gives {url, payload}. For a real chain the docs
 * only say `execution.params` carries the contract address, ABI, method and parameters, so we accept that shape and then
 * hold the result to hard rules: the target MUST be the funding channel's own Funds Storage address (and the pinned one when
 * configured), the method MUST be `withdraw`, it MUST exist in the given ABI as non-payable, and no ETH is ever sent.
 * Anything else is `unsupported` and nothing is sent.
 */
export function withdrawalAction(
  intent: Pick<WithdrawalIntent, "execution">,
  channel: FundingChannel,
  cfg: Pick<ImmersveConfig, "fundsStorageAddress">,
  forbidden: readonly string[],
): WithdrawalAction {
  const ex = intent.execution ?? {};
  if (typeof ex.url === "string" && ex.payload && typeof ex.payload === "object") return { kind: "simulator", url: ex.url, payload: ex.payload as Record<string, unknown> };

  const p = ex.params as { address?: unknown; contractAddress?: unknown; abi?: unknown; method?: unknown; functionName?: unknown; params?: unknown; args?: unknown } | undefined;
  if (!p || typeof p !== "object") return { kind: "unsupported", reason: "The card issuer's withdrawal instructions are in a format we don't support yet. Nothing was sent." };
  const target = str(p.address) ?? str(p.contractAddress);
  const method = str(p.method) ?? str(p.functionName);
  const args = Array.isArray(p.params) ? p.params : Array.isArray(p.args) ? p.args : null;
  if (!target || !method || !args || !Array.isArray(p.abi)) return { kind: "unsupported", reason: "The card issuer's withdrawal instructions are incomplete. Nothing was sent." };
  if (method !== "withdraw") return { kind: "unsupported", reason: "The card issuer asked for an action other than a withdrawal, so we stopped. Nothing was sent." };

  const storage = fundsStorageFor(channel, cfg, forbidden);
  if (!storage.ok) return { kind: "unsupported", reason: storage.reason };
  if (!isAddress(target) || getAddress(target) !== storage.address) return { kind: "unsupported", reason: "The withdrawal is not addressed to the card issuer's funds contract, so we stopped. Nothing was sent." };

  const fn = (p.abi as { type?: string; name?: string; stateMutability?: string; inputs?: { type?: string }[] }[]).find((f) => f?.type === "function" && f.name === "withdraw");
  if (!fn || fn.stateMutability === "payable" || (fn.inputs?.length ?? -1) !== args.length) return { kind: "unsupported", reason: "The withdrawal instructions don't match the contract they point to. Nothing was sent." };
  try {
    // JSON cannot carry bigints: integer arguments arrive as numbers or numeric strings.
    const typed = args.map((v, i) => (/^u?int\d*$/.test(fn.inputs?.[i]?.type ?? "") && (typeof v === "string" || typeof v === "number") ? BigInt(v) : v));
    const data = encodeFunctionData({ abi: p.abi as Abi, functionName: "withdraw", args: typed });
    return { kind: "onchain", to: storage.address, data };
  } catch {
    return { kind: "unsupported", reason: "The withdrawal instructions could not be read. Nothing was sent." };
  }
}
