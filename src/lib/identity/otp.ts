/**
 * One-time-password providers. The provider owns code generation, delivery, expiry and per-code attempt limits, so
 * our service never sees or stores a valid code when a real provider (Twilio Verify) is used.
 */
export type CheckResult = "approved" | "rejected" | "expired";

export interface OtpProvider {
  readonly name: string;
  /** Send a code to an E.164 number. Throws on delivery failure. */
  start(e164: string): Promise<void>;
  check(e164: string, code: string): Promise<CheckResult>;
}

/** In-memory provider with Twilio-like semantics: 6 digits, 10 minute expiry, 5 checks per code. For dev and tests only. */
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock";
  private codes = new Map<string, { code: string; expiresAt: number; checks: number }>();

  constructor(
    private opts: { fixedCode?: string; ttlMs?: number; maxChecks?: number; now?: () => number } = {},
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  async start(e164: string): Promise<void> {
    const code = this.opts.fixedCode ?? String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    this.codes.set(e164, { code, expiresAt: this.now() + (this.opts.ttlMs ?? 600_000), checks: 0 });
  }

  async check(e164: string, code: string): Promise<CheckResult> {
    const entry = this.codes.get(e164);
    if (!entry || this.now() > entry.expiresAt) return "expired";
    entry.checks += 1;
    if (entry.checks > (this.opts.maxChecks ?? 5)) return "expired";
    if (entry.code !== code) return "rejected";
    this.codes.delete(e164); // a code works once
    return "approved";
  }

  /** Test helper: the code last sent to a number. */
  peek(e164: string): string | undefined {
    return this.codes.get(e164)?.code;
  }
}

export interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  /**
   * Name shown in the SMS: "Your <brand> verification code is: ...". Sent per verification as Twilio's documented
   * `CustomFriendlyName`, so it overrides the Verify service's own name (which is set in the Twilio console).
   */
  brand?: string;
  fetchImpl?: typeof fetch;
}

/** Twilio friendly names are short plain text. Letters, digits, spaces and a few separators only; empty means "unset". */
export function cleanBrand(raw: string | undefined): string {
  return (raw ?? "").replace(/[^A-Za-z0-9 .\-]/g, "").trim().slice(0, 30);
}

/**
 * Twilio Verify (https://www.twilio.com/docs/verify/api). Enable Fraud Guard and restrict geo permissions on the
 * Verify service in the Twilio console; those protections live there, not in this client.
 */
export class TwilioVerifyProvider implements OtpProvider {
  readonly name = "twilio-verify";
  constructor(private cfg: TwilioVerifyConfig) {}

  private async post(path: string, body: Record<string, string>): Promise<Response> {
    const f = this.cfg.fetchImpl ?? fetch;
    return f(`https://verify.twilio.com/v2/Services/${this.cfg.serviceSid}/${path}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${this.cfg.accountSid}:${this.cfg.authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
  }

  async start(e164: string): Promise<void> {
    const brand = cleanBrand(this.cfg.brand);
    let res = await this.post("Verifications", { To: e164, Channel: "sms", ...(brand ? { CustomFriendlyName: brand } : {}) });
    // Never let the cosmetic name stop a real user from getting a code: if Twilio rejects the request as invalid
    // (400), try once more without it. Rate limits (429) and server errors are not retried: they are not about the name.
    if (res.status === 400 && brand) res = await this.post("Verifications", { To: e164, Channel: "sms" });
    if (!res.ok) throw new Error(`twilio start failed: ${res.status}`);
  }

  async check(e164: string, code: string): Promise<CheckResult> {
    const res = await this.post("VerificationCheck", { To: e164, Code: code });
    // 404: the verification expired, was already approved, or hit Twilio's own attempt limit.
    if (res.status === 404 || res.status === 429) return "expired";
    if (!res.ok) throw new Error(`twilio check failed: ${res.status}`);
    const json = (await res.json()) as { status?: string };
    return json.status === "approved" ? "approved" : "rejected";
  }
}
