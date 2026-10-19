/**
 * Phone number validation (E.164) and privacy helpers. Shared by the browser and the verification Worker, so it
 * uses relative imports only.
 */
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type { CountryCode };

export interface Country {
  iso: CountryCode;
  name: string;
  /** Calling code with a leading plus, e.g. "+91". */
  dial: string;
  flag: string;
}

const flagOf = (iso: string) => String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));

let cache: Country[] | null = null;

/** All countries libphonenumber knows, sorted by name. */
export function listCountries(): Country[] {
  if (cache) return cache;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  cache = getCountries()
    .map((iso) => ({ iso, name: names.of(iso) ?? iso, dial: `+${getCountryCallingCode(iso)}`, flag: flagOf(iso) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export type PhoneErrorCode = "EMPTY" | "INVALID_FORMAT" | "INVALID_NUMBER" | "NOT_MOBILE" | "COUNTRY_NOT_ALLOWED";

export const PHONE_MESSAGES: Record<PhoneErrorCode, string> = {
  EMPTY: "Enter your mobile number.",
  INVALID_FORMAT: "Use international format, e.g. +14155552671.",
  INVALID_NUMBER: "That doesn't look like a valid phone number.",
  NOT_MOBILE: "Use a mobile number that can receive SMS.",
  COUNTRY_NOT_ALLOWED: "Verification isn't available in this country yet.",
};

export type PhoneCheck =
  | { ok: true; e164: string; country: CountryCode | undefined; national: string }
  | { ok: false; code: PhoneErrorCode; message: string };

const fail = (code: PhoneErrorCode): PhoneCheck => ({ ok: false, code, message: PHONE_MESSAGES[code] });

/** Line types that cannot receive a verification SMS (or are abusable): rejected. Unknown types are allowed. */
const REJECTED_TYPES = new Set(["FIXED_LINE", "TOLL_FREE", "PREMIUM_RATE", "SHARED_COST", "VOIP", "PERSONAL_NUMBER", "PAGER", "UAN", "VOICEMAIL"]);

/** Strict E.164: "+", a non-zero first digit, 7-15 digits in total. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** Validate an already-formatted E.164 number. */
export function validateE164(input: string, allowedCountries?: readonly string[]): PhoneCheck {
  const raw = input.trim();
  if (!raw) return fail("EMPTY");
  if (!E164.test(raw)) return fail("INVALID_FORMAT");
  const p = parsePhoneNumberFromString(raw);
  if (!p || !p.isValid()) return fail("INVALID_NUMBER");
  const type = p.getType();
  if (type && REJECTED_TYPES.has(type)) return fail("NOT_MOBILE");
  if (allowedCountries?.length && (!p.country || !allowedCountries.includes(p.country))) return fail("COUNTRY_NOT_ALLOWED");
  return { ok: true, e164: p.number, country: p.country, national: p.formatNational() };
}

/** Combine a country and a national number as typed by the user (spaces, dashes and a trunk 0 are fine). */
export function normalizePhone(input: { country: CountryCode; national: string }, allowedCountries?: readonly string[]): PhoneCheck {
  const typed = input.national.trim();
  if (!typed) return fail("EMPTY");
  if (/[^\d\s().\-+]/.test(typed)) return fail("INVALID_FORMAT");
  const p = parsePhoneNumberFromString(typed, input.country);
  if (!p) return fail("INVALID_NUMBER");
  return validateE164(p.number, allowedCountries);
}

/** "+919876543210" -> "+91 ••••••3210": enough for the user to recognise their number, nothing more. */
export function maskPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  const cc = p ? `+${p.countryCallingCode}` : e164.slice(0, 3);
  const rest = p ? p.nationalNumber : e164.slice(cc.length);
  return `${cc} ${"•".repeat(Math.max(rest.length - 4, 2))}${rest.slice(-4)}`;
}

/** Best-effort default country from the browser locale (e.g. "en-IN" -> "IN"). */
export function guessCountry(locale: string | undefined): CountryCode {
  const region = locale?.split("-")[1]?.toUpperCase();
  return region && listCountries().some((c) => c.iso === region) ? (region as CountryCode) : "US";
}
