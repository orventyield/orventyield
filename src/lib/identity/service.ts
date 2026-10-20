/**
 * Phone-OTP verification and the one-user-one-card registry.
 *
 * Runs unchanged in the Cloudflare Worker (D1 store, Twilio Verify) and in the browser Playground (memory store,
 * mock provider), so there is a single implementation of the rules.
 *
 * Threat model, in short:
 * - SMS pumping / credit drain: per-IP and per-phone limits, a resend cooldown, a global daily SMS budget, and a
 *   duplicate check that runs BEFORE any SMS is sent;
 * - brute-forcing a code: 5 checks per session, a check-rate limit per phone, and the provider's own limits;
 * - owning someone else's wallet address: wallet owners must sign a message that contains the session nonce;
 * - second cards: UNIQUE(phone_hash) and UNIQUE(owner) in the store, plus the pure rule in registry.ts;
 * - data exposure: only HMAC hashes are stored; raw numbers only transit to the OTP provider.
 */
import { isAddress, verifyMessage } from "viem";
import { ipKey, phoneHash as hashPhone } from "./hash";
import { maskPhone, validateE164, type PhoneErrorCode } from "./phone";
import { OtpProviderError, type OtpProvider } from "./otp";
import { CLAIM_MESSAGES, normalizeOwner } from "./registry";
import type { VerifyStore } from "./store";

export interface Limits {
  startPerIp10m: number;
  startPerIpDay: number;
  startPerPhoneHour: number;
  startPerPhoneDay: number;
  checkPerPhone10m: number;
}

export interface VerifyConfig {
  /** Secret key for the phone and IP hashes. Never ship it to the browser in a real deployment. */
  pepper: string;
  /** ISO country codes allowed to verify; empty or undefined = all. */
  allowedCountries?: string[];
  /** Wallet owners must prove ownership by signing the activation message. */
  requireWalletSignature: boolean;
  sessionTtlMs: number;
  resendCooldownMs: number;
  maxCheckAttempts: number;
  /** Hard cap on SMS sent per UTC day, across all users: bounds the worst-case bill. */
  dailySmsCap: number;
  limits: Limits;
}

export const DEFAULT_CONFIG: Omit<VerifyConfig, "pepper"> = {
  requireWalletSignature: true,
  sessionTtlMs: 10 * 60_000,
  resendCooldownMs: 30_000,
  maxCheckAttempts: 5,
  dailySmsCap: 500,
  limits: { startPerIp10m: 5, startPerIpDay: 20, startPerPhoneHour: 3, startPerPhoneDay: 6, checkPerPhone10m: 10 },
};

export type VerifyErrorCode =
  | PhoneErrorCode
  | "INVALID_OWNER"
  | "RATE_LIMITED"
  | "COOLDOWN"
  | "SMS_BUDGET"
  | "PHONE_ALREADY_BOUND"
  | "OWNER_ALREADY_HAS_CARD"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_CODE"
  | "BAD_SIGNATURE"
  | "SMS_BLOCKED"
  | "NUMBER_UNREACHABLE"
  | "COUNTRY_UNSUPPORTED"
  | "PROVIDER_ERROR";

const STATUS: Record<VerifyErrorCode, number> = {
  EMPTY: 400,
  INVALID_FORMAT: 400,
  INVALID_NUMBER: 400,
  NOT_MOBILE: 400,
  COUNTRY_NOT_ALLOWED: 400,
  INVALID_OWNER: 400,
  RATE_LIMITED: 429,
  COOLDOWN: 429,
  SMS_BUDGET: 503,
  PHONE_ALREADY_BOUND: 409,
  OWNER_ALREADY_HAS_CARD: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_EXPIRED: 410,
  TOO_MANY_ATTEMPTS: 429,
  INVALID_CODE: 400,
  BAD_SIGNATURE: 401,
  SMS_BLOCKED: 503,
  NUMBER_UNREACHABLE: 422,
  COUNTRY_UNSUPPORTED: 422,
  PROVIDER_ERROR: 502,
};

export class VerifyError extends Error {
  readonly status: number;
  constructor(
    readonly code: VerifyErrorCode,
    message: string,
    readonly extra: { retryAfterSec?: number; attemptsLeft?: number } = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

const MESSAGES: Partial<Record<VerifyErrorCode, string>> = {
  INVALID_OWNER: "Unrecognised account.",
  RATE_LIMITED: "Too many attempts. Please try again later.",
  COOLDOWN: "Please wait before requesting another code.",
  SMS_BUDGET: "Verification is temporarily unavailable. Please try again later.",
  PHONE_ALREADY_BOUND: CLAIM_MESSAGES.PHONE_ALREADY_BOUND,
  OWNER_ALREADY_HAS_CARD: CLAIM_MESSAGES.OWNER_ALREADY_HAS_CARD,
  SESSION_NOT_FOUND: "This verification session wasn't found. Request a new code.",
  SESSION_EXPIRED: "That code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many incorrect codes. Request a new one.",
  INVALID_CODE: "That code isn't right.",
  BAD_SIGNATURE: "Wallet signature didn't match this account.",
  SMS_BLOCKED: "SMS is temporarily unavailable for your region. Please try again later.",
  NUMBER_UNREACHABLE: "We can't send a code to that number. Check it, or try another mobile number.",
  COUNTRY_UNSUPPORTED: "We can't send codes to that country yet.",
  PROVIDER_ERROR: "We couldn't send the code. Please try again.",
};

/**
 * What a provider failure means for the user. Twilio Verify codes, from docs: 60410 / 60605 delivery blocked and 60412 / 60238
 * fraud prevention (Fraud Guard); 60205 landline, 60612 not mobile, 60625 cancelled number, 21211 invalid number, 21608 unverified
 * number on a trial account, 60200 invalid parameter; 60610 / 60607 unsupported country. Everything else stays a generic failure,
 * and the exact code is in the log either way.
 */
export function classifyProviderError(e: unknown): { code: VerifyErrorCode; retryAfterSec?: number } {
  const c = e instanceof OtpProviderError ? e.providerCode : 0;
  if ([60410, 60605, 60412, 60238].includes(c)) return { code: "SMS_BLOCKED" };
  if ([60205, 60612, 60625, 21211, 21608, 60200].includes(c)) return { code: "NUMBER_UNREACHABLE" };
  if ([60610, 60607].includes(c)) return { code: "COUNTRY_UNSUPPORTED" };
  if ([60203, 60212, 60626, 60624].includes(c)) return { code: "RATE_LIMITED", retryAfterSec: 3600 };
  return { code: "PROVIDER_ERROR" };
}

/** A structured, number-free record of a provider failure, for the Worker log (`wrangler tail` / Workers Logs). */
export interface ProviderFailureLog {
  evt: "otp_provider_failed";
  operation: "start" | "check";
  httpStatus: number;
  providerCode: number;
  detail: string;
  userCode: VerifyErrorCode;
  /** ISO country of the number, e.g. "IN". No digits of the number itself. */
  country?: string;
}
const msg = (c: VerifyErrorCode) => MESSAGES[c] ?? "Request rejected.";

const GUEST = /^guest:[A-Za-z0-9_-]{16,64}$/;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The exact text a wallet owner signs. Built identically by the server and the client. */
export function activationMessage(p: { owner: string; masked: string; nonce: string; issuedAt: number }): string {
  return [
    "OrventYield card activation",
    "",
    `Wallet: ${normalizeOwner(p.owner)}`,
    `Phone: ${p.masked}`,
    `Nonce: ${p.nonce}`,
    `Issued: ${new Date(p.issuedAt).toISOString()}`,
    "",
    "Signing proves you own this wallet. It costs no gas and moves no funds.",
  ].join("\n");
}

export interface StartInput {
  phone: string;
  owner: string;
  ip: string;
}
export type StartResult =
  | { alreadyActive: true }
  | {
      alreadyActive: false;
      nonce: string;
      expiresAt: number;
      resendAfterSec: number;
      maskedPhone: string;
      messageToSign?: string;
      /** This number already has a card on another wallet or device. Verifying moves it here. */
      relink?: boolean;
    };

export interface CheckInput {
  phone: string;
  code: string;
  owner: string;
  nonce: string;
  ip: string;
  signature?: string;
}
export interface CheckResult {
  active: true;
  activatedAt: number;
  maskedPhone: string;
  /** Pseudonymous, non-reversible id of the verified identity (truncated HMAC). Lets clients mirror 1U1C. */
  identityId: string;
  /** The card was already active on another wallet or device and has been moved to this one. */
  relinked?: boolean;
}

export class VerificationService {
  private now: () => number;
  private id: () => string;

  constructor(
    private deps: {
      store: VerifyStore;
      otp: OtpProvider;
      config: VerifyConfig;
      now?: () => number;
      randomId?: () => string;
      /** Receives number-free diagnostics when the provider fails (the Worker writes them to its log). */
      log?: (entry: ProviderFailureLog) => void;
    },
  ) {
    this.now = deps.now ?? Date.now;
    this.id =
      deps.randomId ??
      (() =>
        [...crypto.getRandomValues(new Uint8Array(16))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""));
  }

  private get cfg() {
    return this.deps.config;
  }

  private checkOwner(owner: string): string {
    if (isAddress(owner, { strict: false }) || GUEST.test(owner)) return normalizeOwner(owner);
    throw new VerifyError("INVALID_OWNER", msg("INVALID_OWNER"));
  }

  private parsePhone(phone: string) {
    const r = validateE164(phone, this.cfg.allowedCountries);
    if (!r.ok) throw new VerifyError(r.code, r.message);
    return r;
  }

  /** Throw RATE_LIMITED (with Retry-After) when `max` events of this kind already happened in the window. */
  private async enforce(kind: Parameters<VerifyStore["countEvents"]>[0], key: string, windowMs: number, max: number, code: VerifyErrorCode = "RATE_LIMITED") {
    const now = this.now();
    // An event exactly `windowMs` old has left the window (strictly-newer-than semantics).
    const times = await this.deps.store.eventsSince(kind, key, now - windowMs + 1);
    if (times.length >= max) {
      const oldest = times[times.length - max]!;
      throw new VerifyError(code, msg(code), { retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) });
    }
  }

  async status(ownerRaw: string): Promise<{ active: boolean; activatedAt?: number }> {
    const owner = this.checkOwner(ownerRaw);
    const card = await this.deps.store.getCardByOwner(owner);
    return card ? { active: true, activatedAt: card.activatedAt } : { active: false };
  }

  async start(input: StartInput): Promise<StartResult> {
    const { store, otp } = this.deps;
    const owner = this.checkOwner(input.owner);
    const phone = this.parsePhone(input.phone);
    const now = this.now();
    const hash = await hashPhone(this.cfg.pepper, phone.e164);
    const ip = await ipKey(this.cfg.pepper, input.ip || "unknown");

    // 1) Throttle by network address first, and count every attempt, so the duplicate check below cannot be
    //    used to enumerate registered numbers at speed.
    await this.enforce("start_ip", ip, 10 * MIN, this.cfg.limits.startPerIp10m);
    await this.enforce("start_ip", ip, DAY, this.cfg.limits.startPerIpDay);
    await store.recordEvent("start_ip", ip, now);

    // 2) One user = one card, decided BEFORE any SMS is sent.
    const mine = await store.getCardByOwner(owner);
    if (mine) {
      if (mine.phoneHash === hash) return { alreadyActive: true };
      throw new VerifyError("OWNER_ALREADY_HAS_CARD", msg("OWNER_ALREADY_HAS_CARD"));
    }
    // A number that already has a card on ANOTHER wallet is not an error: it is a returning user. They get a code like anyone
    // else, and proving the phone (OTP) moves the card here. The same rate limits and budget apply as for any SMS.
    const holder = await store.getCardByPhone(hash);
    const relink = !!holder && holder.owner !== owner;

    // 3) Per-phone limits, resend cooldown, and the global daily SMS budget.
    const recent = await store.eventsSince("start_phone", hash, now - this.cfg.resendCooldownMs + 1);
    if (recent.length) {
      throw new VerifyError("COOLDOWN", msg("COOLDOWN"), { retryAfterSec: Math.max(1, Math.ceil((recent[recent.length - 1]! + this.cfg.resendCooldownMs - now) / 1000)) });
    }
    await this.enforce("start_phone", hash, HOUR, this.cfg.limits.startPerPhoneHour);
    await this.enforce("start_phone", hash, DAY, this.cfg.limits.startPerPhoneDay);
    if ((await store.countEvents("sms_global", "all", now - DAY + 1)) >= this.cfg.dailySmsCap) throw new VerifyError("SMS_BUDGET", msg("SMS_BUDGET"));

    // Count before sending: a failing provider must not become a free retry loop.
    await store.recordEvent("start_phone", hash, now);
    await store.recordEvent("sms_global", "all", now);
    try {
      await otp.start(phone.e164);
    } catch (e) {
      const k = classifyProviderError(e);
      this.deps.log?.({
        evt: "otp_provider_failed",
        operation: "start",
        httpStatus: e instanceof OtpProviderError ? e.httpStatus : 0,
        providerCode: e instanceof OtpProviderError ? e.providerCode : 0,
        detail: e instanceof OtpProviderError ? e.detail : "network or unknown error",
        userCode: k.code,
        country: phone.country,
      });
      throw new VerifyError(k.code, msg(k.code), k.retryAfterSec ? { retryAfterSec: k.retryAfterSec } : {});
    }

    const nonce = this.id();
    const expiresAt = now + this.cfg.sessionTtlMs;
    await store.createSession({ nonce, phoneHash: hash, owner, createdAt: now, expiresAt, attempts: 0, used: false });
    if (Math.random() < 0.05) await store.prune(now - 2 * DAY);

    const maskedPhone = maskPhone(phone.e164);
    return {
      alreadyActive: false,
      nonce,
      expiresAt,
      resendAfterSec: Math.ceil(this.cfg.resendCooldownMs / 1000),
      maskedPhone,
      messageToSign: this.needsSignature(owner) ? activationMessage({ owner, masked: maskedPhone, nonce, issuedAt: now }) : undefined,
      ...(relink ? { relink: true } : {}),
    };
  }

  private needsSignature(owner: string): boolean {
    return this.cfg.requireWalletSignature && isAddress(owner, { strict: false });
  }

  async check(input: CheckInput): Promise<CheckResult> {
    const { store, otp } = this.deps;
    const owner = this.checkOwner(input.owner);
    const phone = this.parsePhone(input.phone);
    const now = this.now();
    const hash = await hashPhone(this.cfg.pepper, phone.e164);
    if (!/^\d{6}$/.test(input.code)) throw new VerifyError("INVALID_CODE", msg("INVALID_CODE"), { attemptsLeft: undefined });

    // A session is bound to (nonce, owner, phone). Any mismatch looks the same as "not found".
    const session = await store.getSession(input.nonce);
    if (!session || session.owner !== owner || session.phoneHash !== hash) throw new VerifyError("SESSION_NOT_FOUND", msg("SESSION_NOT_FOUND"));
    if (session.used || now > session.expiresAt) throw new VerifyError("SESSION_EXPIRED", msg("SESSION_EXPIRED"));
    if (session.attempts >= this.cfg.maxCheckAttempts) {
      await store.markSessionUsed(session.nonce);
      throw new VerifyError("TOO_MANY_ATTEMPTS", msg("TOO_MANY_ATTEMPTS"));
    }

    await this.enforce("check_phone", hash, 10 * MIN, this.cfg.limits.checkPerPhone10m);
    await store.recordEvent("check_phone", hash, now);

    // Wallet ownership is verified before the code is spent, so a bad signature never burns an attempt.
    const masked = maskPhone(phone.e164);
    if (this.needsSignature(owner)) {
      const expected = activationMessage({ owner, masked, nonce: session.nonce, issuedAt: session.createdAt });
      let ok = false;
      try {
        ok = !!input.signature && (await verifyMessage({ address: owner as `0x${string}`, message: expected, signature: input.signature as `0x${string}` }));
      } catch {
        ok = false;
      }
      if (!ok) throw new VerifyError("BAD_SIGNATURE", msg("BAD_SIGNATURE"));
    }

    const attempts = await store.incrementAttempts(session.nonce);
    let verdict;
    try {
      verdict = await otp.check(phone.e164, input.code);
    } catch (e) {
      this.deps.log?.({
        evt: "otp_provider_failed",
        operation: "check",
        httpStatus: e instanceof OtpProviderError ? e.httpStatus : 0,
        providerCode: e instanceof OtpProviderError ? e.providerCode : 0,
        detail: e instanceof OtpProviderError ? e.detail : "network or unknown error",
        userCode: "PROVIDER_ERROR",
        country: phone.country,
      });
      throw new VerifyError("PROVIDER_ERROR", msg("PROVIDER_ERROR"));
    }
    if (verdict === "expired") {
      await store.markSessionUsed(session.nonce);
      throw new VerifyError("SESSION_EXPIRED", msg("SESSION_EXPIRED"));
    }
    if (verdict === "rejected") {
      const left = Math.max(0, this.cfg.maxCheckAttempts - attempts);
      if (left === 0) {
        await store.markSessionUsed(session.nonce);
        throw new VerifyError("TOO_MANY_ATTEMPTS", msg("TOO_MANY_ATTEMPTS"), { attemptsLeft: 0 });
      }
      throw new VerifyError("INVALID_CODE", msg("INVALID_CODE"), { attemptsLeft: left });
    }

    // Approved: spend the session, then claim the card atomically.
    await store.markSessionUsed(session.nonce);
    const res = await store.insertCard({ phoneHash: hash, owner, activatedAt: now });
    const identityId = hash.slice(0, 24);
    if (res === "ok") return { active: true, activatedAt: now, maskedPhone: masked, identityId };

    // Lost a race, the same user re-verifying, or a returning user on a new wallet: decide from what is actually stored.
    const mine = await store.getCardByOwner(owner);
    if (mine && mine.phoneHash === hash) return { active: true, activatedAt: mine.activatedAt, maskedPhone: masked, identityId };
    if (res === "phone_taken") {
      // The phone just proved it is theirs: move the card here. The previous wallet no longer holds it.
      const moved = await store.moveCard(hash, owner);
      if (moved === "ok") {
        const now2 = await store.getCardByOwner(owner);
        return { active: true, activatedAt: now2?.activatedAt ?? now, maskedPhone: masked, identityId, relinked: true };
      }
      if (moved === "not_found") {
        // The card disappeared between the two steps: claim it normally.
        if ((await store.insertCard({ phoneHash: hash, owner, activatedAt: now })) === "ok") return { active: true, activatedAt: now, maskedPhone: masked, identityId };
      }
    }
    throw new VerifyError("OWNER_ALREADY_HAS_CARD", msg("OWNER_ALREADY_HAS_CARD"));
  }
}
