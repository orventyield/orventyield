import { describe, expect, it, vi } from "vitest";
import { CHAIN_ADD_PARAMS, switchOrAddChain } from "../../src/lib/chainSwitch";
import { ARBITRUM_CHAIN_ID } from "../../src/lib/contracts/arbitrum";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_EXPLORER, ROBINHOOD_RPC } from "../../src/lib/contracts/robinhood";

describe("CHAIN_ADD_PARAMS", () => {
  it("defines accurate EIP-3085 parameters for Robinhood Chain", () => {
    const rh = CHAIN_ADD_PARAMS[ROBINHOOD_CHAIN_ID];
    expect(rh).toBeDefined();
    expect(rh?.chainId).toBe("0x1237");
    expect(rh?.chainName).toBe("Robinhood Chain");
    expect(rh?.rpcUrls).toEqual([ROBINHOOD_RPC]);
    expect(rh?.blockExplorerUrls).toEqual([ROBINHOOD_EXPLORER]);
    expect(rh?.nativeCurrency).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
  });

  it("defines accurate EIP-3085 parameters for Arbitrum One", () => {
    const arb = CHAIN_ADD_PARAMS[ARBITRUM_CHAIN_ID];
    expect(arb).toBeDefined();
    expect(arb?.chainId).toBe("0xa4b1");
    expect(arb?.chainName).toBe("Arbitrum One");
    expect(arb?.nativeCurrency).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
  });
});

describe("switchOrAddChain", () => {
  it("returns true immediately if already on target chain", async () => {
    const mockConfig = {
      state: { chainId: ROBINHOOD_CHAIN_ID },
    } as any;
    const res = await switchOrAddChain(mockConfig, ROBINHOOD_CHAIN_ID);
    expect(res).toBe(true);
  });
});
