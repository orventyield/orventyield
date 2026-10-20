import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D1Store } from "../../src/lib/identity/d1";
import { MockOtpProvider, OtpProviderError, type OtpProvider } from "../../src/lib/identity/otp";
import { DEFAULT_CONFIG, VerificationService, VerifyError, classifyProviderError, type ProviderFailureLog, type VerifyConfig } from "../../src/lib/identity/service";
import { MemoryStore, type VerifyStore } from "../../src/lib/identity/store";
import { sqliteD1 } from "../helpers/sqliteD1";

const PHONE_A = "+919876543210";
const PHONE_B = "+447911123456";
const PHONE_C = "+14155552671";
const guest = (n: string) => `guest:${n.padEnd(16, "x")}`;
const ADDR_1 = "0x1111111111111111111111111111111111111111";

interface Ctx {
  svc: VerificationService;
  store: VerifyStore;
  otp: MockOtpProvider;
  clock: { t: number };
  sqlRaw?: { prepare(sql: string): { all(): unknown[] } };
}

function make(kind: "memory" | "sqlite", cfg: Partial<VerifyConfig> = {}, ids?: () => string, custom?: OtpProvider): Ctx {
  const clock = { t: 1_800_000_000_000 };
  const otp = (custom as MockOtpProvider | undefined) ?? new MockOtpProvider({ now: () => clock.t });
  let store: VerifyStore;
  let sqlRaw: Ctx["sqlRaw"];
  if (kind === "memory") store = new MemoryStore();
  else {
    const s = sqliteD1();
    store = new D1Store(s.db);
    sqlRaw = s.raw;
  }
  const svc = new VerificationService({
    store,
    otp,
    now: () => clock.t,
    randomId: ids,
    config: { ...DEFAULT_CONFIG, pepper: "test-pepper", requireWalletSignature: false, ...cfg },
  });
  return { svc, store, otp, clock, sqlRaw };
}

/** Start + check in one go for a guest owner. */
async function activate(c: Ctx, owner: string, phone: string, ip = "9.9.9.9") {
  const s = await c.svc.start({ phone, owner, ip });
  if (s.alreadyActive) return s;
  return c.svc.check({ phone, owner, nonce: s.nonce, code: c.otp.peek(phone)!, ip });
}

async function fails(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof VerifyError) return e;
    throw e;
  }
  throw new Error("expected a VerifyError");
}

describe.each(["memory", "sqlite"] as const)("verification service (%s store)", (kind) => {
  let c: Ctx;
  beforeEach(() => {
    c = make(kind);
  });

  describe("happy path", () => {
    it("sends a code, verifies it and activates one card", async () => {
      const s = await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" });
      expect(s).toMatchObject({ alreadyActive: false, resendAfterSec: 30, maskedPhone: "+91 ••••••3210" });
      const r = await c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: (s as { nonce: string }).nonce, code: c.otp.peek(PHONE_A)!, ip: "1.1.1.1" });
      expect(r).toMatchObject({ active: true, maskedPhone: "+91 ••••••3210" });
      expect(await c.svc.status(guest("alice"))).toMatchObject({ active: true });
      expect(await c.svc.status(guest("bob"))).toEqual({ active: false });
    });

    it("re-activating the same owner and phone is a no-op that sends no SMS", async () => {
      await activate(c, guest("alice"), PHONE_A);
      const spy = vi.spyOn(c.otp, "start");
      expect(await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "2.2.2.2" })).toEqual({ alreadyActive: true });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("one user = one card", () => {
    it("a number that already has a card is a returning user: it gets a code and is told this is a re-link", async () => {
      await activate(c, guest("alice"), PHONE_A);
      c.clock.t += 31_000; // past the per-phone resend cooldown
      const spy = vi.spyOn(c.otp, "start");
      const s = await c.svc.start({ phone: PHONE_A, owner: guest("newdevice"), ip: "3.3.3.3" });
      expect(s).toMatchObject({ alreadyActive: false, relink: true });
      expect(spy).toHaveBeenCalledTimes(1); // proof of the phone is required, so an SMS IS sent
      // Nothing moves until the code is proven: alice still holds the card, the new device does not
      expect((await c.svc.status(guest("alice"))).active).toBe(true);
      expect((await c.svc.status(guest("newdevice"))).active).toBe(false);
    });

    it("proving the phone moves the card: the new owner is active, the previous one is not (one holder per phone)", async () => {
      const first = await activate(c, guest("alice"), PHONE_A);
      if ("alreadyActive" in first) throw new Error("unexpected");
      c.clock.t += 31_000;
      const s = await c.svc.start({ phone: PHONE_A, owner: guest("newdevice"), ip: "3.3.3.3" });
      if (s.alreadyActive) throw new Error("unexpected");
      const r = await c.svc.check({ phone: PHONE_A, owner: guest("newdevice"), nonce: s.nonce, code: c.otp.peek(PHONE_A)!, ip: "3.3.3.3" });
      expect(r).toMatchObject({ active: true, relinked: true, identityId: first.identityId });
      expect(r.activatedAt).toBe(first.activatedAt); // card age is preserved
      expect((await c.svc.status(guest("newdevice"))).active).toBe(true);
      expect((await c.svc.status(guest("alice"))).active).toBe(false);
    });

    it("a wrong code never re-links, and the original holder keeps the card", async () => {
      await activate(c, guest("alice"), PHONE_A);
      c.clock.t += 31_000;
      const s = await c.svc.start({ phone: PHONE_A, owner: guest("mallory"), ip: "3.3.3.3" });
      if (s.alreadyActive) throw new Error("unexpected");
      const e = await fails(c.svc.check({ phone: PHONE_A, owner: guest("mallory"), nonce: s.nonce, code: "000000", ip: "3.3.3.3" }));
      expect(e.code).toBe("INVALID_CODE");
      expect((await c.svc.status(guest("alice"))).active).toBe(true);
      expect((await c.svc.status(guest("mallory"))).active).toBe(false);
    });

    it("an owner that already has a card for ANOTHER phone cannot re-link a second one", async () => {
      await activate(c, guest("alice"), PHONE_A, "1.1.1.1");
      await activate(c, guest("bob"), PHONE_B, "2.2.2.2");
      const e = await fails(c.svc.start({ phone: PHONE_A, owner: guest("bob"), ip: "3.3.3.3" }));
      expect(e.code).toBe("OWNER_ALREADY_HAS_CARD");
      expect((await c.svc.status(guest("alice"))).active).toBe(true);
    });

    it("re-linking a wallet requires its signature, so nobody can pull a card onto a wallet they do not own", async () => {
      const w = make(kind, { requireWalletSignature: true });
      const alice = guest("alice");
      await activate(w, alice, PHONE_A);
      w.clock.t += 31_000;
      const victim = "0x3333333333333333333333333333333333333333";
      const s = await w.svc.start({ phone: PHONE_A, owner: victim, ip: "4.4.4.4" });
      if (s.alreadyActive) throw new Error("unexpected");
      expect(s.relink).toBe(true);
      expect(s.messageToSign).toBeTruthy();
      const e = await fails(w.svc.check({ phone: PHONE_A, owner: victim, nonce: s.nonce, code: w.otp.peek(PHONE_A)!, ip: "4.4.4.4" })); // no signature
      expect(e.code).toBe("BAD_SIGNATURE");
      expect((await w.svc.status(alice)).active).toBe(true);
    });

    it("rejects a second phone for an owner that already has a card", async () => {
      await activate(c, guest("alice"), PHONE_A);
      const e = await fails(c.svc.start({ phone: PHONE_B, owner: guest("alice"), ip: "3.3.3.3" }));
      expect(e.code).toBe("OWNER_ALREADY_HAS_CARD");
    });

    it("lets different people each have their own card", async () => {
      await activate(c, guest("alice"), PHONE_A, "1.1.1.1");
      await activate(c, guest("bob"), PHONE_B, "2.2.2.2");
      await activate(c, "0x2222222222222222222222222222222222222222", PHONE_C, "3.3.3.3");
      expect((await c.svc.status(guest("bob"))).active).toBe(true);
    });

    it("a race for the same phone yields exactly one card", async () => {
      // Both users legitimately complete OTP for the same number at the same time.
      const a = await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" });
      c.clock.t += 31_000; // cooldown
      const b = await c.svc.start({ phone: PHONE_A, owner: guest("mallory"), ip: "2.2.2.2" });
      const code = c.otp.peek(PHONE_A)!;
      const results = await Promise.allSettled([
        c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: (a as { nonce: string }).nonce, code, ip: "1.1.1.1" }),
        c.svc.check({ phone: PHONE_A, owner: guest("mallory"), nonce: (b as { nonce: string }).nonce, code, ip: "2.2.2.2" }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      expect(ok.length).toBeLessThanOrEqual(1);
      const owners = (await Promise.all([c.svc.status(guest("alice")), c.svc.status(guest("mallory"))])).filter((s) => s.active);
      expect(owners).toHaveLength(1);
    });
  });

  describe("OTP checks", () => {
    it("wrong code reports attempts left, then locks the session after five", async () => {
      const s = (await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const base = { phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, ip: "1.1.1.1" };
      const e1 = await fails(c.svc.check({ ...base, code: "000000" }));
      expect(e1).toMatchObject({ code: "INVALID_CODE", extra: { attemptsLeft: 4 } });
      for (let i = 0; i < 3; i++) await fails(c.svc.check({ ...base, code: "000000" }));
      const last = await fails(c.svc.check({ ...base, code: "000000" }));
      expect(last.code).toBe("TOO_MANY_ATTEMPTS");
      // even the right code no longer works on a locked session
      const after = await fails(c.svc.check({ ...base, code: c.otp.peek(PHONE_A)! }));
      expect(["SESSION_EXPIRED", "TOO_MANY_ATTEMPTS"]).toContain(after.code);
      expect((await c.svc.status(guest("alice"))).active).toBe(false);
    });

    it("rejects non-6-digit codes without spending an attempt", async () => {
      const s = (await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const e = await fails(c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, code: "12ab56", ip: "1.1.1.1" }));
      expect(e.code).toBe("INVALID_CODE");
      const ok = await c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, code: c.otp.peek(PHONE_A)!, ip: "1.1.1.1" });
      expect(ok.active).toBe(true);
    });

    it("a session expires after ten minutes", async () => {
      const s = (await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const code = c.otp.peek(PHONE_A)!;
      c.clock.t += 10 * 60_000 + 1;
      const e = await fails(c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, code, ip: "1.1.1.1" }));
      expect(e.code).toBe("SESSION_EXPIRED");
    });

    it("the service enforces the attempt cap itself, whatever the provider does", async () => {
      const s = (await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      for (let i = 0; i < 5; i++) await c.store.incrementAttempts(s.nonce);
      const e = await fails(c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, code: c.otp.peek(PHONE_A)!, ip: "1.1.1.1" }));
      expect(e.code).toBe("TOO_MANY_ATTEMPTS");
      expect((await c.svc.status(guest("alice"))).active).toBe(false);
    });

    it("a used session is rejected even when the provider would approve the same code again", async () => {
      const lenient: OtpProvider = { name: "always", start: async () => {}, check: async () => "approved" };
      const k = make(kind, {}, undefined, lenient);
      const s = (await k.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const input = { phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, code: "123456", ip: "1.1.1.1" };
      await k.svc.check(input);
      expect((await fails(k.svc.check(input))).code).toBe("SESSION_EXPIRED");
    });

    it("a session cannot be reused after success (replay)", async () => {
      const s = (await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const input = { phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, code: c.otp.peek(PHONE_A)!, ip: "1.1.1.1" };
      await c.svc.check(input);
      expect((await fails(c.svc.check(input))).code).toBe("SESSION_EXPIRED");
    });

    it("a session is bound to its owner and phone", async () => {
      const s = (await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const code = c.otp.peek(PHONE_A)!;
      expect((await fails(c.svc.check({ phone: PHONE_A, owner: guest("mallory"), nonce: s.nonce, code, ip: "1.1.1.1" }))).code).toBe("SESSION_NOT_FOUND");
      expect((await fails(c.svc.check({ phone: PHONE_B, owner: guest("alice"), nonce: s.nonce, code, ip: "1.1.1.1" }))).code).toBe("SESSION_NOT_FOUND");
      expect((await fails(c.svc.check({ phone: PHONE_A, owner: guest("alice"), nonce: "nope", code, ip: "1.1.1.1" }))).code).toBe("SESSION_NOT_FOUND");
    });
  });

  describe("rate limiting and SMS budget", () => {
    it("limits OTP requests per IP (5 per 10 minutes) and reports Retry-After", async () => {
      for (let i = 0; i < 5; i++) {
        // distinct phones and owners from one IP
        const phone = `+9198765432${String(10 + i)}`;
        await c.svc.start({ phone, owner: guest(`u${i}`), ip: "6.6.6.6" });
      }
      const e = await fails(c.svc.start({ phone: "+919876543299", owner: guest("u9"), ip: "6.6.6.6" }));
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.status).toBe(429);
      expect(e.extra.retryAfterSec).toBeGreaterThan(0);
      expect(e.extra.retryAfterSec).toBeLessThanOrEqual(600);
      // a different IP is unaffected
      await expect(c.svc.start({ phone: "+919876543299", owner: guest("u9"), ip: "7.7.7.7" })).resolves.toBeTruthy();
    });

    it("the limit lifts when the window passes", async () => {
      for (let i = 0; i < 5; i++) await c.svc.start({ phone: `+9198765432${10 + i}`, owner: guest(`u${i}`), ip: "6.6.6.6" });
      await fails(c.svc.start({ phone: "+919876543299", owner: guest("u9"), ip: "6.6.6.6" }));
      c.clock.t += 10 * 60_000 + 1000;
      await expect(c.svc.start({ phone: "+919876543299", owner: guest("u9"), ip: "6.6.6.6" })).resolves.toBeTruthy();
    });

    it("enforces a 30 second resend cooldown per phone", async () => {
      await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" });
      c.clock.t += 5_000;
      const e = await fails(c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.2" }));
      expect(e.code).toBe("COOLDOWN");
      expect(e.extra.retryAfterSec).toBe(25);
      c.clock.t += 25_000;
      await expect(c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.3" })).resolves.toBeTruthy();
    });

    it("caps SMS per phone per hour (3)", async () => {
      for (let i = 0; i < 3; i++) {
        await c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: `1.1.1.${i}` });
        c.clock.t += 31_000;
      }
      const e = await fails(c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.9" }));
      expect(e.code).toBe("RATE_LIMITED");
    });

    it("stops sending when the global daily SMS budget is spent", async () => {
      const small = make(kind, { dailySmsCap: 3, limits: { ...DEFAULT_CONFIG.limits, startPerIp10m: 100, startPerIpDay: 100 } });
      for (let i = 0; i < 3; i++) await small.svc.start({ phone: `+9198765432${10 + i}`, owner: guest(`u${i}`), ip: `5.5.5.${i}` });
      const e = await fails(small.svc.start({ phone: "+919876543299", owner: guest("u9"), ip: "5.5.5.9" }));
      expect(e.code).toBe("SMS_BUDGET");
      small.clock.t += 24 * 3600_000 + 1;
      await expect(small.svc.start({ phone: "+919876543299", owner: guest("u9"), ip: "5.5.5.9" })).resolves.toBeTruthy();
    });

    it("re-link attempts are throttled per IP and per phone like any other SMS", async () => {
      await activate(c, guest("alice"), PHONE_A, "1.1.1.1");
      c.clock.t += 31_000;
      // the first re-link attempt sends; further ones hit the resend cooldown and then the per-phone limits, never an unbounded SMS stream
      const first = await c.svc.start({ phone: PHONE_A, owner: guest("m0"), ip: "8.8.8.8" });
      expect(first).toMatchObject({ relink: true });
      expect((await fails(c.svc.start({ phone: PHONE_A, owner: guest("m1"), ip: "8.8.8.8" }))).code).toBe("COOLDOWN");
      const sent = vi.spyOn(c.otp, "start");
      for (let i = 2; i < 12; i++) {
        c.clock.t += 31_000;
        await c.svc.start({ phone: PHONE_A, owner: guest(`m${i}`), ip: `8.8.8.${i}` }).catch(() => undefined);
      }
      expect(sent.mock.calls.length).toBeLessThanOrEqual(2); // 3 per phone per hour, one already used above
    });

    it("failed provider sends still count against the limits", async () => {
      vi.spyOn(c.otp, "start").mockRejectedValue(new Error("boom"));
      const e = await fails(c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" }));
      expect(e.code).toBe("PROVIDER_ERROR");
      c.clock.t += 31_000;
      for (let i = 0; i < 2; i++) {
        await fails(c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: `1.1.1.${i + 2}` }));
        c.clock.t += 31_000;
      }
      expect((await fails(c.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.9" }))).code).toBe("RATE_LIMITED");
    });

    it("limits code checks per phone", async () => {
      const lim = make(kind, { maxCheckAttempts: 100, limits: { ...DEFAULT_CONFIG.limits, checkPerPhone10m: 3 } });
      const s = (await lim.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })) as { nonce: string };
      const base = { phone: PHONE_A, owner: guest("alice"), nonce: s.nonce, ip: "1.1.1.1" };
      for (let i = 0; i < 3; i++) await fails(lim.svc.check({ ...base, code: "000000" }));
      expect((await fails(lim.svc.check({ ...base, code: "000000" }))).code).toBe("RATE_LIMITED");
    });
  });

  describe("input validation", () => {
    it.each([
      ["+12345", "INVALID_FORMAT"],
      ["9876543210", "INVALID_FORMAT"],
      ["+442071838750", "NOT_MOBILE"],
    ])("rejects phone %s", async (phone, code) => {
      const e = await fails(c.svc.start({ phone, owner: guest("alice"), ip: "1.1.1.1" }));
      expect(e.code).toBe(code);
      expect(e.status).toBe(400);
    });
    it("rejects unknown owner formats", async () => {
      expect((await fails(c.svc.start({ phone: PHONE_A, owner: "alice", ip: "1.1.1.1" }))).code).toBe("INVALID_OWNER");
      expect((await fails(c.svc.status("0x123"))).code).toBe("INVALID_OWNER");
    });
    it("honours the country allow-list", async () => {
      const geo = make(kind, { allowedCountries: ["IN"] });
      expect((await fails(geo.svc.start({ phone: PHONE_B, owner: guest("alice"), ip: "1.1.1.1" }))).code).toBe("COUNTRY_NOT_ALLOWED");
      await expect(geo.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" })).resolves.toBeTruthy();
    });
  });

  describe("wallet ownership", () => {
    it("wallet owners must sign the activation message; a valid signature activates", async () => {
      const w = make(kind, { requireWalletSignature: true });
      const acct = privateKeyToAccount(generatePrivateKey());
      const s = await w.svc.start({ phone: PHONE_A, owner: acct.address, ip: "1.1.1.1" });
      if (s.alreadyActive) throw new Error("unexpected");
      expect(s.messageToSign).toContain(`Wallet: ${acct.address.toLowerCase()}`);
      expect(s.messageToSign).toContain(`Nonce: ${s.nonce}`);
      expect(s.messageToSign).toContain("moves no funds");
      const signature = await acct.signMessage({ message: s.messageToSign! });
      const r = await w.svc.check({ phone: PHONE_A, owner: acct.address, nonce: s.nonce, code: w.otp.peek(PHONE_A)!, ip: "1.1.1.1", signature });
      expect(r.active).toBe(true);
      expect((await w.svc.status(acct.address.toUpperCase().replace("0X", "0x"))).active).toBe(true);
    });

    it("a missing, foreign or tampered signature is rejected and does not burn an OTP attempt", async () => {
      const w = make(kind, { requireWalletSignature: true });
      const victim = privateKeyToAccount(generatePrivateKey());
      const attacker = privateKeyToAccount(generatePrivateKey());
      const s = await w.svc.start({ phone: PHONE_A, owner: victim.address, ip: "1.1.1.1" });
      if (s.alreadyActive) throw new Error("unexpected");
      const base = { phone: PHONE_A, owner: victim.address, nonce: s.nonce, code: w.otp.peek(PHONE_A)!, ip: "1.1.1.1" };
      expect((await fails(w.svc.check(base))).code).toBe("BAD_SIGNATURE");
      const foreign = await attacker.signMessage({ message: s.messageToSign! });
      expect((await fails(w.svc.check({ ...base, signature: foreign }))).code).toBe("BAD_SIGNATURE");
      const other = await victim.signMessage({ message: s.messageToSign! + " " });
      expect((await fails(w.svc.check({ ...base, signature: other }))).code).toBe("BAD_SIGNATURE");
      // the legitimate owner can still finish: no attempts were spent
      const good = await victim.signMessage({ message: s.messageToSign! });
      expect((await w.svc.check({ ...base, signature: good })).active).toBe(true);
    });

    it("guests are not asked for a signature", async () => {
      const w = make(kind, { requireWalletSignature: true });
      const s = await w.svc.start({ phone: PHONE_A, owner: guest("alice"), ip: "1.1.1.1" });
      if (s.alreadyActive) throw new Error("unexpected");
      expect(s.messageToSign).toBeUndefined();
    });
  });

  describe("privacy", () => {
    it("never returns or stores the raw phone number or IP", async () => {
      await activate(c, guest("alice"), PHONE_A, "203.0.113.77");
      if (kind === "sqlite") {
        const dump = JSON.stringify(
          ["cards", "otp_sessions", "events"].map((t) => c.sqlRaw!.prepare(`SELECT * FROM ${t}`).all()),
        );
        expect(dump).not.toContain("9876543210");
        expect(dump).not.toContain("919876");
        expect(dump).not.toContain("203.0.113.77");
        expect(dump).toMatch(/[0-9a-f]{64}/);
      }
    });
    it("the stored identifier changes with the secret (a leaked database alone is not enough to enumerate numbers)", async () => {
      const other = make(kind, { pepper: "different-pepper" });
      await activate(c, guest("alice"), PHONE_A);
      await activate(other, guest("alice"), PHONE_A);
      if (kind === "sqlite") {
        const a = (c.sqlRaw!.prepare("SELECT phone_hash FROM cards").all() as { phone_hash: string }[])[0]!.phone_hash;
        const b = (other.sqlRaw!.prepare("SELECT phone_hash FROM cards").all() as { phone_hash: string }[])[0]!.phone_hash;
        expect(a).not.toBe(b);
      }
    });
  });
});

describe("D1 constraints (the database enforces 1U1C itself)", () => {
  it("UNIQUE(phone_hash) and UNIQUE(owner) reject duplicates at the SQL level", async () => {
    const { db } = sqliteD1();
    const store = new D1Store(db);
    expect(await store.insertCard({ phoneHash: "h1", owner: "o1", activatedAt: 1 })).toBe("ok");
    expect(await store.insertCard({ phoneHash: "h1", owner: "o2", activatedAt: 2 })).toBe("phone_taken");
    expect(await store.insertCard({ phoneHash: "h2", owner: "o1", activatedAt: 3 })).toBe("owner_taken");
    expect((await store.getCardByPhone("h1"))?.owner).toBe("o1");
  });
});

describe("provider failures are classified, explained to the user, and logged without the number", () => {
  const PHONE = "+919876543210";
  const mkSvc = (err: unknown) => {
    const logs: ProviderFailureLog[] = [];
    const otp = new MockOtpProvider();
    vi.spyOn(otp, "start").mockRejectedValue(err);
    const svc = new VerificationService({ store: new MemoryStore(), otp, log: (l) => logs.push(l), config: { ...DEFAULT_CONFIG, pepper: "test-pepper", requireWalletSignature: false } });
    return { svc, logs };
  };
  const err = (code: number, httpStatus = 400, detail = "") => new OtpProviderError("start", httpStatus, code, detail);

  it.each([
    [60410, "SMS_BLOCKED", 503], [60605, "SMS_BLOCKED", 503], [60412, "SMS_BLOCKED", 503], [60238, "SMS_BLOCKED", 503],
    [60205, "NUMBER_UNREACHABLE", 422], [60612, "NUMBER_UNREACHABLE", 422], [21211, "NUMBER_UNREACHABLE", 422], [21608, "NUMBER_UNREACHABLE", 422],
    [60610, "COUNTRY_UNSUPPORTED", 422], [60607, "COUNTRY_UNSUPPORTED", 422],
    [60203, "RATE_LIMITED", 429], [60212, "RATE_LIMITED", 429], [60626, "RATE_LIMITED", 429],
    [20003, "PROVIDER_ERROR", 502], [0, "PROVIDER_ERROR", 502], [99999, "PROVIDER_ERROR", 502],
  ])("Twilio %i becomes %s (HTTP %i)", async (code, userCode, status) => {
    const { svc, logs } = mkSvc(err(code as number, 403, "some detail"));
    const e = await fails(svc.start({ phone: PHONE, owner: guest("alice"), ip: "1.1.1.1" }));
    expect(e.code).toBe(userCode);
    expect(e.status).toBe(status);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ evt: "otp_provider_failed", operation: "start", providerCode: code, httpStatus: 403, userCode, country: "IN" });
  });

  it("tells the user in plain words that SMS is temporarily unavailable for their region", async () => {
    const { svc } = mkSvc(err(60410, 403));
    const e = await fails(svc.start({ phone: PHONE, owner: guest("alice"), ip: "1.1.1.1" }));
    expect(e.message).toBe("SMS is temporarily unavailable for your region. Please try again later.");
  });

  it("the log line never contains the phone number, the owner or the IP", async () => {
    const { svc, logs } = mkSvc(err(60410, 403, "blocked prefix"));
    await fails(svc.start({ phone: PHONE, owner: guest("alice"), ip: "203.0.113.77" }));
    const line = JSON.stringify(logs[0]);
    expect(line).not.toMatch(/9876543210|203\.0\.113|alice/);
  });

  it("an unknown error (network, not a provider reply) is a generic failure and is still logged", async () => {
    const { svc, logs } = mkSvc(new Error("socket hang up"));
    const e = await fails(svc.start({ phone: PHONE, owner: guest("alice"), ip: "1.1.1.1" }));
    expect(e.code).toBe("PROVIDER_ERROR");
    expect(logs[0]).toMatchObject({ providerCode: 0, httpStatus: 0, detail: "network or unknown error" });
  });

  it("a failed send still counts against the limits (no free retry loop)", async () => {
    const { svc } = mkSvc(err(60410, 403));
    await fails(svc.start({ phone: PHONE, owner: guest("alice"), ip: "1.1.1.1" }));
    const again = await fails(svc.start({ phone: PHONE, owner: guest("alice"), ip: "1.1.1.1" }));
    expect(again.code).toBe("COOLDOWN");
  });

  it("classifyProviderError is total: anything unknown is a generic provider error", () => {
    for (const x of [null, undefined, "x", {}, new Error("e"), new OtpProviderError("start", 500, 0, "")]) expect(classifyProviderError(x).code).toBe("PROVIDER_ERROR");
  });
});
