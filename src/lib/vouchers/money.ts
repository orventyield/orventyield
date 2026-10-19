import { MAX_VOUCHER_USDC } from "./brands";

/**
 * Convert the provider's USDC price (a JSON number) into 6-decimal base units, rounding UP.
 * Under-paying a crypto invoice can lose the funds, so we never round down. Returns null for anything unsafe:
 * non-finite, zero or negative, or above the per-voucher ceiling.
 */
export function usdcBaseUnitsCeil(price: unknown): bigint | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > MAX_VOUCHER_USDC) return null;
  // toFixed(3) of price*1e6 removes binary-float noise (25.31 * 1e6 = 25310000.000000004) before ceiling.
  return BigInt(Math.ceil(Number((price * 1_000_000).toFixed(3))));
}

import { isAddress } from "viem";

/**
 * A well-formed EVM address. All-lowercase is accepted; mixed case must carry a valid EIP-55 checksum, because a bad
 * checksum means the address was mistyped or corrupted and funds sent to it could be lost.
 */
export const isEvmAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && isAddress(v, { strict: true });
