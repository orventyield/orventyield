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
