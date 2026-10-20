import { describe, expect, it } from "vitest";
import { checkSourceFunds, gasHint, type SourceFundsInput } from "../../src/features/deposit/sourceFunds";

const base: SourceFundsInput = { chainName: "Base", nativeSymbol: "ETH", nativeBalance: 10n ** 16n, payingNative: false, tokenSymbol: "USDC", tokenDecimals: 6, tokenBalance: 50_000_000n, amount: 10_000_000n };

describe("checkSourceFunds", () => {
  it("ok when there is gas and enough of the token", () => expect(checkSourceFunds(base)).toEqual({ kind: "ok" }));
  it("ok while the amount is empty", () => expect(checkSourceFunds({ ...base, amount: 0n }).kind).toBe("ok"));
  it("no native token on the chain is a gas problem, named by chain and symbol", () => {
    const r = checkSourceFunds({ ...base, nativeBalance: 0n });
    expect(r).toMatchObject({ kind: "no-gas" });
    expect((r as { message: string }).message).toContain("Insufficient gas on Base");
    expect((r as { message: string }).message).toContain("ETH");
  });
  it("gas is reported before funds when both are missing", () => expect(checkSourceFunds({ ...base, nativeBalance: 0n, tokenBalance: 0n }).kind).toBe("no-gas"));
  it("not enough of the token shows what you have and what you need", () => {
    const r = checkSourceFunds({ ...base, tokenBalance: 5_500_000n, amount: 10_000_000n });
    expect(r.kind).toBe("no-funds");
    expect((r as { message: string }).message).toContain("5.5 USDC");
    expect((r as { message: string }).message).toContain("need 10");
  });
  it("exact balance and dust amounts are fine; one base unit over is not", () => {
    expect(checkSourceFunds({ ...base, tokenBalance: 10_000_000n }).kind).toBe("ok");
    expect(checkSourceFunds({ ...base, tokenBalance: 1n, amount: 1n }).kind).toBe("ok");
    expect(checkSourceFunds({ ...base, tokenBalance: 10_000_000n, amount: 10_000_001n }).kind).toBe("no-funds");
  });
  it("paying with the native token reminds to leave gas", () => {
    const r = checkSourceFunds({ ...base, payingNative: true, tokenSymbol: "ETH", tokenDecimals: 18, tokenBalance: 10n ** 16n, amount: 2n * 10n ** 16n });
    expect((r as { message: string }).message).toContain("Leave some for gas");
  });
});

describe("gasHint", () => {
  it("names the chain and token once known, and is generic before", () => {
    expect(gasHint("Base", "ETH")).toContain("Base");
    expect(gasHint("Polygon", "POL")).toContain("POL");
    expect(gasHint(undefined, undefined)).toContain("native token");
  });
});
