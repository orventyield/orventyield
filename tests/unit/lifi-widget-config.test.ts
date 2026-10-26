import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { SOURCE_CHAIN_IDS, SOURCE_TOKENS, SUPPLY_CALL_GAS_LIMIT, buildLifiWidgetConfig } from "../../src/features/deposit/lifiWidgetConfig";

const SAFE = "0x00000000000000000000000000000000000000aa";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const supplyAbi = parseAbi(["function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)"]);

describe("buildLifiWidgetConfig: locked destination", () => {
  const c = buildLifiWidgetConfig({ safe: SAFE });
  it("targets native USDC on Arbitrum One", () => {
    expect(c.toChain).toBe(42161);
    expect(c.toToken).toBe(USDC);
  });
  it("sets toAddress to the checksummed Safe and locks it", () => {
    expect(c.toAddress?.address).toBe(getAddress(SAFE));
    expect(String(c.toAddress?.chainType)).toBe("EVM");
    expect(c.disabledUI?.toAddress).toBe(true);
    expect(c.disabledUI?.toToken).toBe(true);
    expect(c.requiredUI?.toAddress).toBe(true);
  });
  it("restricts destination and source chains", () => {
    expect(c.chains?.to?.allow).toEqual([42161]);
    expect(c.chains?.from?.allow).toEqual([...SOURCE_CHAIN_IDS]);
    expect([...SOURCE_CHAIN_IDS].sort((a, b) => a - b)).toEqual([1, 10, 137, 8453, 42161]);
  });
  it("plain mode has no contract calls", () => {
    expect(c.mode).toBeUndefined();
    expect(c.contractCalls).toBeUndefined();
    expect(c.toAmount).toBeUndefined();
  });
  it("uses dark appearance and a bounded slippage", () => {
    expect(c.appearance).toBe("dark");
    expect(c.slippage).toBeGreaterThan(0);
    expect(c.slippage).toBeLessThanOrEqual(0.01);
  });
  it("token allowlist only names allowed chains and has unique, checksummed entries", () => {
    const keys = SOURCE_TOKENS.map((t) => `${t.chainId}:${t.address}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of SOURCE_TOKENS) {
      expect(SOURCE_CHAIN_IDS).toContain(t.chainId);
      expect(getAddress(t.address)).toBe(t.address);
    }
  });
});

describe("buildLifiWidgetConfig: input validation", () => {
  it("rejects missing, malformed and zero Safe addresses", () => {
    expect(() => buildLifiWidgetConfig({ safe: "" })).toThrow();
    expect(() => buildLifiWidgetConfig({ safe: "0x123" })).toThrow();
    expect(() => buildLifiWidgetConfig({ safe: "0x0000000000000000000000000000000000000000" })).toThrow();
  });
  it("rejects a negative supply amount", () => {
    expect(() => buildLifiWidgetConfig({ safe: SAFE, supplyAmount: -1n })).toThrow();
  });
  it("treats zero supply amount as plain mode", () => {
    expect(buildLifiWidgetConfig({ safe: SAFE, supplyAmount: 0n }).contractCalls).toBeUndefined();
  });
});

describe("buildLifiWidgetConfig: Aave supply contract call", () => {
  const call = (amt: bigint) => buildLifiWidgetConfig({ safe: SAFE, supplyAmount: amt });
  it.each([1n, 1_000_000n, 123_456_789n, 2n ** 128n])("encodes Pool.supply(USDC, %s, Safe, 0)", (amt) => {
    const c = call(amt);
    expect(c.mode).toBe("custom");
    expect(c.contractCalls).toHaveLength(1);
    const cc = c.contractCalls![0]!;
    expect(cc.toContractAddress).toBe(POOL);
    expect(cc.fromTokenAddress).toBe(USDC);
    expect(cc.fromAmount).toBe(amt.toString());
    expect(cc.toContractGasLimit).toBe(SUPPLY_CALL_GAS_LIMIT);
    const d = decodeFunctionData({ abi: supplyAbi, data: cc.toContractCallData as `0x${string}` });
    expect(d.functionName).toBe("supply");
    expect(d.args).toEqual([USDC, amt, getAddress(SAFE), 0]);
  });
  it("onBehalfOf is the Safe, never the connected wallet", () => {
    const d = decodeFunctionData({ abi: supplyAbi, data: call(5_000_000n).contractCalls![0]!.toContractCallData as `0x${string}` });
    expect(d.args![2]).toBe(getAddress(SAFE));
  });
  it("formats toAmount as a decimal USDC string without float math", () => {
    expect(call(1n).toAmount).toBe("0.000001");
    expect(call(1_000_000n).toAmount).toBe("1");
    expect(call(12_345_678n).toAmount).toBe("12.345678");
    expect(call(10n ** 15n).toAmount).toBe("1000000000");
  });
});

describe("buildLifiWidgetConfig: Robinhood Chain destination", () => {
  const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
  it("targets Paxos USDG on Robinhood Chain when specified", () => {
    const c = buildLifiWidgetConfig({ safe: SAFE, toChainId: 4663, toTokenAddress: USDG });
    expect(c.toChain).toBe(4663);
    expect(c.toToken).toBe(USDG);
    expect(c.toAddress?.name).toBe("Your Robinhood Safe");
    expect(c.toAddress?.address).toBe(getAddress(SAFE));
    expect(c.chains?.to?.allow).toEqual([4663]);
    expect(c.tokens?.to?.allow).toEqual([{ chainId: 4663, address: USDG }]);
  });
  it("defaults to Paxos USDG if toTokenAddress is omitted on Robinhood Chain", () => {
    const c = buildLifiWidgetConfig({ safe: SAFE, toChainId: 4663 });
    expect(c.toChain).toBe(4663);
    expect(c.toToken).toBe(USDG);
    expect(c.toAddress?.name).toBe("Your Robinhood Safe");
  });
  it("does not attach Aave contract calls on Robinhood Chain", () => {
    const c = buildLifiWidgetConfig({ safe: SAFE, toChainId: 4663, supplyAmount: 1000000n });
    expect(c.contractCalls).toBeUndefined();
    expect(c.mode).toBeUndefined();
  });
});

