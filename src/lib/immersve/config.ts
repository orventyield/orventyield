import type { ImmersveConfig } from "./types";

type Env = Partial<Record<string, string | undefined>>;

// Next only inlines NEXT_PUBLIC_* when written as literal `process.env.NAME`, so read them explicitly.
const BUILD_ENV: Env = {
  NEXT_PUBLIC_IMMERSVE_BASE_URL: process.env.NEXT_PUBLIC_IMMERSVE_BASE_URL,
  NEXT_PUBLIC_IMMERSVE_CLIENT_APP_ID: process.env.NEXT_PUBLIC_IMMERSVE_CLIENT_APP_ID,
  NEXT_PUBLIC_IMMERSVE_PARTNER_ID: process.env.NEXT_PUBLIC_IMMERSVE_PARTNER_ID,
  NEXT_PUBLIC_IMMERSVE_CARD_PROGRAM_ID: process.env.NEXT_PUBLIC_IMMERSVE_CARD_PROGRAM_ID,
  NEXT_PUBLIC_IMMERSVE_FUNDING_CHANNEL_ID: process.env.NEXT_PUBLIC_IMMERSVE_FUNDING_CHANNEL_ID,
  NEXT_PUBLIC_IMMERSVE_NETWORK: process.env.NEXT_PUBLIC_IMMERSVE_NETWORK,
  NEXT_PUBLIC_IMMERSVE_FUNDS_STORAGE: process.env.NEXT_PUBLIC_IMMERSVE_FUNDS_STORAGE,
};

/** Public IDs only (safe for the browser bundle). Defaults are Immersve's documented PUBLIC SANDBOX. */
export function immersveConfig(env: Env = BUILD_ENV): ImmersveConfig {
  return {
    baseUrl: env.NEXT_PUBLIC_IMMERSVE_BASE_URL || "https://test.immersve.com",
    clientApplicationId: env.NEXT_PUBLIC_IMMERSVE_CLIENT_APP_ID || "d0b05d44204810fc61991a49e289dda3",
    partnerAccountId: env.NEXT_PUBLIC_IMMERSVE_PARTNER_ID || "d1bc97edfa4f7dc9b56726c7d82a9956",
    cardProgramId: env.NEXT_PUBLIC_IMMERSVE_CARD_PROGRAM_ID || "7dfa2e3ed390493ab307fac622f05ae9",
    fundingChannelId: env.NEXT_PUBLIC_IMMERSVE_FUNDING_CHANNEL_ID || "4cdc4310718674342d561647194e2446",
    network: env.NEXT_PUBLIC_IMMERSVE_NETWORK || "polygon-amoy",
    fundsStorageAddress: env.NEXT_PUBLIC_IMMERSVE_FUNDS_STORAGE || undefined,
  };
}

/**
 * The default issuer is Immersve's public SANDBOX: a test network, a test KYC page and test cards. A real user must never be
 * sent there, so a production build only offers the card flow once it points at the production issuer (all
 * NEXT_PUBLIC_IMMERSVE_* set at build time). Dev, tests and an explicit NEXT_PUBLIC_IMMERSVE_ALLOW_SANDBOX=true keep the sandbox.
 */
export function cardFlowAvailable(cfg: ImmersveConfig, allowSandbox: boolean = SANDBOX_ALLOWED): boolean {
  return cfg.baseUrl === "https://api.immersve.com" || allowSandbox;
}

const SANDBOX_ALLOWED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_IMMERSVE_ALLOW_SANDBOX === "true";
