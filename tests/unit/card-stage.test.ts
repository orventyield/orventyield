import { describe, expect, it } from "vitest";
import { allowanceCents, deriveStage, formatExpiry, groupPan, maskedPan, type StageInput } from "../../src/lib/immersve/stage";
import type { Card } from "../../src/lib/immersve";

const card = (status: string): Card => ({ id: "c1", type: "virtual", status, expiry: "203006", panFirst6: "528854", panLast4: "1179" });
const base: StageInput = { walletConnected: true, phoneVerified: true, sessionActive: true, readiness: { state: "ready" }, cards: [] };
const at = (o: Partial<StageInput>) => deriveStage({ ...base, ...o }).stage;

describe("card journey order", () => {
  it("needs a wallet first", () => expect(at({ walletConnected: false })).toBe("no-wallet"));
  it("asks the verification service before anything else", () => {
    expect(at({ phoneVerified: null })).toBe("checking");
    expect(at({ phoneVerified: false })).toBe("phone");
    // Phone comes before the card provider even if a session exists.
    expect(at({ phoneVerified: false, sessionActive: true })).toBe("phone");
  });
  it("then needs a provider session", () => expect(at({ sessionActive: false })).toBe("provider-login"));
  it("waits for prerequisites and cards to load", () => {
    expect(at({ readiness: null })).toBe("checking");
    expect(at({ cards: null })).toBe("checking");
  });
  it("walks KYC -> pending -> funding -> issue", () => {
    expect(deriveStage({ ...base, readiness: { state: "kyc-required", kycUrl: "https://v/k" } })).toEqual({ stage: "kyc", kycUrl: "https://v/k" });
    expect(at({ readiness: { state: "pending" } })).toBe("pending");
    expect(at({ readiness: { state: "funding-required" } })).toBe("funding");
    expect(at({ readiness: { state: "ready" } })).toBe("issue");
  });
  it("an active card wins over every later state (one account, one card)", () => {
    expect(at({ cards: [card("active")], readiness: { state: "kyc-required", kycUrl: "u" } })).toBe("active");
  });
  it("ignores cards that are not active", () => {
    expect(at({ cards: [card("cancelled")] })).toBe("issue");
  });
});

describe("display helpers", () => {
  it("formats expiry and never invents a date", () => {
    expect(formatExpiry("203006")).toBe("06/30");
    expect(formatExpiry("202912")).toBe("12/29");
    for (const bad of ["", "2030", "203013", "203000", "abcdef"]) expect(formatExpiry(bad)).toBe("••/••");
  });
  it("masks the PAN to first 6 and last 4", () => {
    expect(maskedPan("528854", "1179")).toBe("5288 54•• •••• 1179");
    expect(maskedPan("x", "1179")).toBe("•••• •••• •••• ••••");
  });
  it("groups a revealed PAN", () => {
    expect(groupPan("5288541234561179")).toBe("5288 5412 3456 1179");
    expect(groupPan("123")).toBe("123");
  });
});

describe("spend allowance = available yield", () => {
  it("is zero for zero or negative yield (zero)", () => {
    expect(allowanceCents(0n)).toBe(0);
    expect(allowanceCents(-5n)).toBe(0);
  });
  it("rounds down to whole cents (dust)", () => {
    expect(allowanceCents(9_999n)).toBe(0); // $0.009999
    expect(allowanceCents(10_000n)).toBe(1);
    expect(allowanceCents(1_908_755n)).toBe(190); // $1.908755 -> $1.90
  });
  it("handles large values (max)", () => {
    expect(allowanceCents(1_000_000_000_000n)).toBe(100_000_000); // $1,000,000.00
  });
});
