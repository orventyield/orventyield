import { describe, expect, it } from "vitest";
import { BASE_UNITS_PER_CENT, baseToCents, centsToBase, fundingAction, fundsStorageFor, planTopUp, sameApiHost } from "../../src/lib/immersve/funding";
import type { FundingChannel, Prerequisite } from "../../src/lib/immersve";

describe("units (1 cent = 10,000 USDC base units)", () => {
  it("converts both ways, rounding cents DOWN", () => {
    expect(BASE_UNITS_PER_CENT).toBe(10_000n);
    expect(centsToBase(500)).toBe(5_000_000n);
    expect(baseToCents(5_000_000n)).toBe(500);
    expect(baseToCents(1_908_755n)).toBe(190); // $1.908755 -> $1.90
    expect(baseToCents(9_999n)).toBe(0); // dust
  });
  it("is zero for zero, negative and non-integer input", () => {
    expect(baseToCents(0n)).toBe(0);
    expect(baseToCents(-5n)).toBe(0);
    for (const bad of [0, -1, 1.5, NaN, Infinity]) expect(centsToBase(bad)).toBe(0n);
  });
  it("handles very large values", () => {
    expect(centsToBase(100_000_000)).toBe(1_000_000_000_000n); // $1,000,000.00
    expect(baseToCents(1_000_000_000_000n)).toBe(100_000_000);
  });
});

const pre = (f: Partial<Prerequisite> & { type?: string }): Prerequisite[] => [{ stage: "aml", status: "ok" }, { stage: "kyc", status: "ok" }, { stage: "funding", status: "action-required", ...f } as Prerequisite];

describe("fundingAction", () => {
  it("is funded when the stage is ok or absent", () => {
    expect(fundingAction([{ stage: "funding", status: "ok" }])).toEqual({ kind: "funded" });
    expect(fundingAction([])).toEqual({ kind: "funded" });
  });
  it("reads the sandbox simulator call exactly as the API sends it", () => {
    const a = fundingAction(pre({ actionType: "simulator_call", type: "simulator_call", params: { url: "https://test.immersve.com/api/simulator/execute-deposit", payload: { amount: "1000000", fundingSourceId: "fs1" } } }));
    expect(a).toEqual({ kind: "simulator", url: "https://test.immersve.com/api/simulator/execute-deposit", payload: { amount: "1000000", fundingSourceId: "fs1" } });
  });
  it("treats a malformed simulator call as unsupported, not as something to guess", () => {
    expect(fundingAction(pre({ actionType: "simulator_call", params: { url: 5 } })).kind).toBe("unsupported");
  });
  it("recognises an on-chain write without parsing its undocumented params", () => {
    expect(fundingAction(pre({ actionType: "smart_contract_write", params: { anything: 1 } }))).toEqual({ kind: "onchain", actionType: "smart_contract_write" });
  });
  it("unknown action types are unsupported", () => {
    expect(fundingAction(pre({ actionType: "wire_transfer" }))).toEqual({ kind: "unsupported", actionType: "wire_transfer" });
  });
});

describe("planTopUp: only yield, whole cents", () => {
  it("defaults to all the withdrawable yield, rounded down to cents, and targets balance + amount", () => {
    const p = planTopUp(1_908_755n, 2_000_000n, null)!;
    expect(p).toEqual({ cents: 190, base: 1_900_000n, targetCents: 390 });
  });
  it("never exceeds the yield even if more is requested", () => {
    expect(planTopUp(1_000_000n, 0n, 5000)!.cents).toBe(100);
  });
  it("honours a smaller request and floors fractions", () => {
    expect(planTopUp(10_000_000n, 0n, 250.9)!.cents).toBe(250);
  });
  it("returns null for no yield, dust, zero or junk requests", () => {
    expect(planTopUp(0n, 0n, null)).toBeNull();
    expect(planTopUp(9_999n, 0n, null)).toBeNull();
    expect(planTopUp(5_000_000n, 0n, 0)).toBeNull();
    expect(planTopUp(5_000_000n, 0n, -3)).toBeNull();
    expect(planTopUp(5_000_000n, 0n, NaN)).toBeNull();
  });
});

const ch = (storageAddress: unknown): FundingChannel => ({ id: "c", fundingTypeName: "arbitrum-mainnet-usdc-universal-evm", mode: "deposit", params: { storageAddress: storageAddress as string } });
const GOOD = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("fundsStorageFor: where a deposit may go", () => {
  it("accepts a valid address from the channel", () => {
    expect(fundsStorageFor(ch(GOOD), {}, [])).toEqual({ ok: true, address: GOOD });
  });
  it("refuses missing, malformed, bad-checksum and zero addresses", () => {
    for (const bad of [undefined, "", "0x123", "0xd8dA6bF26964aF9D7eEd9e03E53415D37aA96045", "0x" + "0".repeat(40)]) {
      expect(fundsStorageFor(ch(bad), {}, []).ok).toBe(false);
    }
  });
  it("must equal the pinned address when one is configured", () => {
    expect(fundsStorageFor(ch(GOOD), { fundsStorageAddress: GOOD.toLowerCase() }, []).ok).toBe(true);
    const r = fundsStorageFor(ch(GOOD), { fundsStorageAddress: "0xcd1c3d1c12437bD0375E3C4331771b31220125Bd" }, []);
    expect(r.ok).toBe(false);
  });
  it("refuses our own contracts", () => {
    expect(fundsStorageFor(ch(GOOD), {}, [GOOD.toLowerCase()]).ok).toBe(false);
  });
});

describe("sameApiHost", () => {
  it("only allows https on the issuer's own host", () => {
    expect(sameApiHost("https://test.immersve.com/api/simulator/execute-deposit", "https://test.immersve.com")).toBe(true);
    for (const bad of ["https://evil.example/x", "http://test.immersve.com/x", "https://test.immersve.com.evil.example/x", "not a url", "https://test.immersve.com:8443/x"]) {
      expect(sameApiHost(bad, "https://test.immersve.com")).toBe(false);
    }
  });
});
