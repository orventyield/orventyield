import { ARBITRUM_CHAIN_ID } from "./contracts/arbitrum";
import { ROBINHOOD_CHAIN_ID } from "./contracts/robinhood";

/** Which yield engine runs on which chain: Aave v3 on Arbitrum One, Morpho VaultV2 on Robinhood Chain. */
export type YieldEngine = "aave" | "morpho";

export const ENGINE_BY_CHAIN: Readonly<Record<number, YieldEngine>> = {
  [ARBITRUM_CHAIN_ID]: "aave",
  [ROBINHOOD_CHAIN_ID]: "morpho",
};

export const isEngineChain = (chainId: number | undefined): chainId is number => chainId !== undefined && chainId in ENGINE_BY_CHAIN;

/**
 * The engine for the selected chain. A wallet sitting on any other network (Base, Ethereum, ...) while bridging does not
 * change engines: it falls back to Arbitrum One (Aave), the default.
 */
export function resolveEngine(chainId: number | undefined): { engine: YieldEngine; chainId: number } {
  if (isEngineChain(chainId)) return { engine: ENGINE_BY_CHAIN[chainId]!, chainId };
  return { engine: "aave", chainId: ARBITRUM_CHAIN_ID };
}

/** The asset a chain's engine holds, and whether the spending rails (vouchers, card, bank / UPI) run on it. */
export function engineAsset(engine: YieldEngine): { symbol: "USDC" | "USDG"; spendingRails: boolean } {
  return engine === "aave" ? { symbol: "USDC", spendingRails: true } : { symbol: "USDG", spendingRails: false };
}

/**
 * Upfront warning when the wallet has no ETH for gas on the engine's chain. `ethBalance` is undefined while it is still loading
 * (no warning then: never claim "no gas" from a missing read).
 */
export function gasWarning(engine: YieldEngine, ethBalance: bigint | undefined): string | null {
  if (ethBalance === undefined || ethBalance > 0n) return null;
  return engine === "morpho" ? "Insufficient ETH for gas on Robinhood Chain. Add a little ETH to your wallet to continue." : "Insufficient ETH for gas on Arbitrum One. Add a little ETH to your wallet to continue.";
}
