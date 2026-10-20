import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { ARBITRUM } from "../../src/lib/contracts/arbitrum";
import { execCalldata, multiSendAbi, packMultiSend, safeAbi, safeCall, safeSetup, withGasBuffer } from "../../src/lib/safe/safe";

const A = getAddress("0x00000000000000000000000000000000000000aa") as Address;
const B = getAddress("0x00000000000000000000000000000000000000bb") as Address;

describe("Safe setup", () => {
  it("is deterministic per owner and differs between owners", () => {
    expect(safeSetup(A)).toEqual(safeSetup(A));
    expect(safeSetup(A).saltNonce).not.toBe(safeSetup(B).saltNonce);
    expect(safeSetup(A).initializer).not.toBe(safeSetup(B).initializer);
  });
  it("makes the owner the only owner with threshold 1", () => {
    const { initializer } = safeSetup(A);
    const d = decodeFunctionData({ abi: safeAbi, data: initializer });
    expect(d.functionName).toBe("setup");
    expect(d.args![0]).toEqual([A]);
    expect(d.args![1]).toBe(1n);
    expect(d.args![4]).toBe(ARBITRUM.safeFallbackHandler);
  });
});

describe("execCalldata", () => {
  it("uses a pre-validated signature (v=1) for the owner, with no gas refund", () => {
    const data = execCalldata(A, B, "0x1234");
    const d = decodeFunctionData({ abi: safeAbi, data });
    expect(d.functionName).toBe("execTransaction");
    const [to, value, inner, op, safeTxGas, baseGas, gasPrice, , , sig] = d.args as [Address, bigint, Hex, number, bigint, bigint, bigint, Address, Address, Hex];
    expect([to, value, inner, op, safeTxGas, baseGas, gasPrice]).toEqual([B, 0n, "0x1234", 0, 0n, 0n, 0n]);
    expect(sig).toBe(`0x${"00".repeat(12)}${A.slice(2).toLowerCase()}${"00".repeat(32)}01`);
  });
});

describe("batching", () => {
  it("a single call is sent directly with CALL", () => {
    expect(safeCall([{ to: B, data: "0xabcd" }])).toEqual({ to: B, data: "0xabcd", operation: 0 });
  });
  it("several calls go through MultiSendCallOnly via delegatecall, packed in order", () => {
    const c = safeCall([{ to: A, data: "0x01" }, { to: B, data: "0x0203" }]);
    expect(c.to).toBe(ARBITRUM.safeMultiSendCallOnly);
    expect(c.operation).toBe(1);
    const d = decodeFunctionData({ abi: multiSendAbi, data: c.data });
    expect(d.args![0]).toBe(packMultiSend([{ to: A, data: "0x01" }, { to: B, data: "0x0203" }]));
    // layout per call: 1 op + 20 to + 32 value + 32 len + data
    const packed = (d.args![0] as string).slice(2);
    expect(packed.length / 2).toBe(85 + 1 + (85 + 2));
    expect(packed.slice(0, 2)).toBe("00");
  });
});

describe("withGasBuffer", () => {
  it("always adds headroom over the estimate (Safe forwards only 63/64 of gas to the inner call)", () => {
    expect(withGasBuffer(100_000n)).toBe(160_000n);
    expect(withGasBuffer(0n)).toBe(30_000n);
    for (const e of [21_000n, 250_000n, 5_000_000n]) expect(withGasBuffer(e)).toBeGreaterThan((e * 64n) / 63n);
  });
});
