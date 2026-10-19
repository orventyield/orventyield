import type { Address } from "viem";

/**
 * Arbitrum One (42161) contracts OrventYield talks to. We deploy none of our own.
 * Verified on an Arbitrum fork on 2026-10-19 (code present; Safe flow and Aave supply/yield/withdraw exercised by
 * scripts/fork-safe-aave.mjs). Cross-check against the official Safe deployments and the Aave address book
 * before any mainnet release. Never add an address that has not been checked.
 */
export const ARBITRUM_CHAIN_ID = 42161;

export const ARBITRUM = {
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // Safe v1.4.1 canonical deployments
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  safeL2Singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  safeFallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  safeMultiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  // Aave v3
  aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
} as const satisfies Record<string, Address>;
