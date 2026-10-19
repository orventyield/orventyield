import { describe, expect, it, vi } from "vitest";
import { MockOtpProvider, TwilioVerifyProvider } from "../../src/lib/identity/otp";
import { claimCard, emptyRegistry, hasCard, normalizeOwner } from "../../src/lib/identity/registry";

const A = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const B = "0x1111111111111111111111111111111111111111";

describe("1U1C registry rule", () => {
  it("binds a phone to one owner and an owner to one phone", () => {
    const r1 = claimCard(emptyRegistry(), A, "phone-1");
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(hasCard(r1.registry, A)).toBe(true);
    expect(hasCard(r1.registry, B)).toBe(false);
  });

  it("rejects the same phone under a different wallet with the required message", () => {
    const r1 = claimCard(emptyRegistry(), A, "phone-1");
    if (!r1.ok) throw new Error("setup");
    const r2 = claimCard(r1.registry, B, "phone-1");
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.code).toBe("PHONE_ALREADY_BOUND");
      expect(r2.message).toBe("Card already active for this verified identity.");
    }
  });

  it("rejects a second phone for the same owner", () => {
    const r1 = claimCard(emptyRegistry(), A, "phone-1");
    if (!r1.ok) throw new Error("setup");
    const r2 = claimCard(r1.registry, A, "phone-2");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("OWNER_ALREADY_HAS_CARD");
  });

  it("is idempotent for the same owner and phone (re-activating on a new device)", () => {
    const r1 = claimCard(emptyRegistry(), A, "phone-1");
    if (!r1.ok) throw new Error("setup");
    const r2 = claimCard(r1.registry, A, "phone-1");
    expect(r2).toMatchObject({ ok: true, idempotent: true });
  });

  it("treats wallet addresses case-insensitively", () => {
    expect(normalizeOwner(A)).toBe(A.toLowerCase());
    const r1 = claimCard(emptyRegistry(), A, "phone-1");
    if (!r1.ok) throw new Error("setup");
    expect(hasCard(r1.registry, A.toLowerCase())).toBe(true);
    expect(claimCard(r1.registry, A.toUpperCase().replace("0X", "0x"), "phone-2").ok).toBe(false);
  });

  it("does not mutate the input registry", () => {
    const reg = emptyRegistry();
    claimCard(reg, A, "phone-1");
    expect(reg).toEqual({ byPhone: {}, byOwner: {} });
  });

  it("many users, one card each", () => {
    let reg = emptyRegistry();
    for (let i = 0; i < 50; i++) {
      const r = claimCard(reg, `guest:user-${String(i).padStart(16, "0")}`, `phone-${i}`);
      expect(r.ok).toBe(true);
      if (r.ok) reg = r.registry;
    }
    expect(Object.keys(reg.byPhone)).toHaveLength(50);
    expect(claimCard(reg, "guest:user-0000000000000099", "phone-7").ok).toBe(false);
  });
});

describe("MockOtpProvider (Twilio-like semantics)", () => {
  it("approves the right code exactly once", async () => {
    const p = new MockOtpProvider();
    await p.start("+919876543210");
    const code = p.peek("+919876543210")!;
    expect(code).toMatch(/^\d{6}$/);
    expect(await p.check("+919876543210", code)).toBe("approved");
    expect(await p.check("+919876543210", code)).toBe("expired");
  });
  it("rejects a wrong code and allows a retry", async () => {
    const p = new MockOtpProvider({ fixedCode: "123456" });
    await p.start("+1");
    expect(await p.check("+1", "000000")).toBe("rejected");
    expect(await p.check("+1", "123456")).toBe("approved");
  });
  it("expires after the TTL", async () => {
    let t = 0;
    const p = new MockOtpProvider({ fixedCode: "123456", ttlMs: 600_000, now: () => t });
    await p.start("+1");
    t = 600_001;
    expect(await p.check("+1", "123456")).toBe("expired");
  });
  it("locks after the maximum number of checks, even for the right code", async () => {
    const p = new MockOtpProvider({ fixedCode: "123456", maxChecks: 5 });
    await p.start("+1");
    for (let i = 0; i < 5; i++) expect(await p.check("+1", "000000")).toBe("rejected");
    expect(await p.check("+1", "123456")).toBe("expired");
  });
  it("a new code replaces the old one", async () => {
    const p = new MockOtpProvider();
    await p.start("+1");
    const first = p.peek("+1");
    await p.start("+1");
    const second = p.peek("+1");
    if (first !== second) expect(await p.check("+1", first!)).toBe("rejected");
  });
  it("generates varied codes", async () => {
    const p = new MockOtpProvider();
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await p.start(`+1${i}`);
      seen.add(p.peek(`+1${i}`)!);
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe("TwilioVerifyProvider request shape", () => {
  const cfg = { accountSid: "ACxxxxxxxx", authToken: "tok", serviceSid: "VAyyyyyyyy" };
  const mk = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("starts an SMS verification with basic auth", async () => {
    const f = mk(201, { status: "pending" });
    await new TwilioVerifyProvider({ ...cfg, fetchImpl: f as unknown as typeof fetch }).start("+919876543210");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://verify.twilio.com/v2/Services/VAyyyyyyyy/Verifications");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("ACxxxxxxxx:tok")}`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("+919876543210");
    expect(body.get("Channel")).toBe("sms");
  });
  it("maps check responses", async () => {
    const ok = new TwilioVerifyProvider({ ...cfg, fetchImpl: mk(200, { status: "approved" }) as unknown as typeof fetch });
    expect(await ok.check("+1", "123456")).toBe("approved");
    const pending = new TwilioVerifyProvider({ ...cfg, fetchImpl: mk(200, { status: "pending" }) as unknown as typeof fetch });
    expect(await pending.check("+1", "000000")).toBe("rejected");
    const gone = new TwilioVerifyProvider({ ...cfg, fetchImpl: mk(404) as unknown as typeof fetch });
    expect(await gone.check("+1", "123456")).toBe("expired");
  });
  it("throws on delivery failure and server errors", async () => {
    await expect(new TwilioVerifyProvider({ ...cfg, fetchImpl: mk(400) as unknown as typeof fetch }).start("+1")).rejects.toThrow();
    await expect(new TwilioVerifyProvider({ ...cfg, fetchImpl: mk(500) as unknown as typeof fetch }).check("+1", "1")).rejects.toThrow();
  });
});
