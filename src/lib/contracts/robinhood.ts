import type { Address } from "viem";
import { ARBITRUM } from "./arbitrum";

/**
 * Robinhood Chain (Arbitrum Orbit L2, chain id 4663). Gas is ETH. We deploy none of our own contracts.
 *
 * Sources and checks (2026-10-23):
 *  - chain id, RPC, explorer: docs.robinhood.com/chain/connecting; `eth_chainId` returned 0x1237 (= 4663).
 *  - Steakhouse USDG vault and USDG: Morpho's public API (VaultV2 list for chain 4663), then read on chain:
 *    vault.asset() == USDG, name "Steakhouse USDG", USDG has 6 decimals, shares have 18.
 *  - Safe v1.4.1 contracts: bytecode IDENTICAL to Arbitrum One's, so the same Safe helpers and the same predicted Safe address
 *    work here (pinned by tests/unit/robinhood-config.test.ts).
 * Never add an address that has not been checked on chain.
 */
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER = "https://robinhoodchain.blockscout.com";

export const ROBINHOOD = {
  /** Paxos Global Dollar, 6 decimals. The only asset the Earn vault takes. */
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  /** Morpho VaultV2 "Steakhouse USDG" (curator: Steakhouse Financial). ERC-4626, 18-decimal shares over a 6-decimal asset. */
  steakhouseUsdgVault: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd",
  /** Morpho Blue core (read-only reference; we never call it directly). */
  morphoBlue: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010",
  // Safe v1.4.1: same addresses and same bytecode as Arbitrum One.
  safeProxyFactory: ARBITRUM.safeProxyFactory,
  safeL2Singleton: ARBITRUM.safeL2Singleton,
  safeFallbackHandler: ARBITRUM.safeFallbackHandler,
  safeMultiSendCallOnly: ARBITRUM.safeMultiSendCallOnly,
} as const satisfies Record<string, Address>;

/**
 * Strict single-vault allowlist (product decision): Morpho vaults are permissionless (52 exist on this chain, most are
 * tests), so the app talks to exactly this one. Adding a vault is a reviewed code change, never a runtime setting.
 */
export const ROBINHOOD_VAULT_ALLOWLIST: readonly Address[] = [ROBINHOOD.steakhouseUsdgVault];

export const USDG_DECIMALS = 6;
export const VAULT_SHARE_DECIMALS = 18;
