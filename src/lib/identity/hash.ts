/**
 * Privacy-preserving identifiers. Raw phone numbers are never stored; the registry only holds an HMAC of the
 * E.164 number keyed with a server-side secret ("pepper").
 *
 * Why HMAC with a secret and not keccak256(phone + salt): phone numbers are a tiny search space (about 10^10 per
 * country), so any hash an attacker can compute offline is reversible by enumeration, whatever the salt, unless the
 * key is secret. A per-user random salt cannot work either: uniqueness needs the same number to map to the same value.
 */
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  if (!secret) throw new Error("hmac secret must not be empty");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Identifier of a verified person in the 1U1C registry. Domain-separated from other uses of the same secret. */
export const phoneHash = (secret: string, e164: string) => hmacSha256Hex(secret, `oy:phone:v1:${e164}`);

/** Rate-limit key for a network address, so raw IPs are not stored either. */
export const ipKey = (secret: string, ip: string) => hmacSha256Hex(secret, `oy:ip:v1:${ip}`);

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
