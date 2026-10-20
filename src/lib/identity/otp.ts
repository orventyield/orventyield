/**
 * One-time-password providers. The provider owns code generation, delivery, expiry and per-code attempt limits, so
 * our service never sees or stores a valid code when a real provider (Twilio Verify) is used.
 */
export type CheckResult = "approved" | "rejected" | "expired";

/**
 * A failure reported by the provider, with the provider's own error code. `detail` is Twilio's message with every number
 * and digit run removed, so it is safe to log and never contains a phone number.
 */
export class OtpProviderError extends Error {
  constructor(
    readonly operation: "start" | "check",
    readonly httpStatus: number,
    /** The provider's error code, e.g. Twilio 60410 (Fraud Guard blocked) or 21608 (unverified number). 0 when unknown. */
    readonly providerCode: number,
    readonly detail: string,
  ) {
    super(`otp ${operation} failed: http ${httpStatus}, code ${providerCode}`);
    this.name = "OtpProviderError";
  }
}

/** Remove phone numbers and any long digit run from provider text before it goes anywhere. */
export function redactDigits(text: string): string {
  return text.replace(/[+(]?\d[\d\s().-]{5,}\d/g, "[number]").slice(0, 200);
}

async function providerError(op: "start" | "check", res: Response): Promise<OtpProviderError> {
  let code = 0;
  let detail = "";
  try {
    const j = (await res.json()) as { code?: unknown; message?: unknown };
    if (typeof j.code === "number" && Number.isFinite(j.code)) code = j.code;
    if (typeof j.message === "string") detail = redactDigits(j.message);
  } catch {
    /* not JSON: keep only the HTTP status */
  }
  return new OtpProviderError(op, res.status, code, detail);
}
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
    // Never let the cosmetic name stop a real user from getting a code: if Twilio says a PARAMETER is invalid (400, code 60200
    // or no code at all), try once more without it. Blocks (60410), rate limits, bad numbers and server errors are not about the
    // name, so they are not retried: a retry would only burn another delivery attempt.
    if (res.status === 400 && brand) {
      const first = await providerError("start", res.clone());
      if (first.providerCode === 0 || first.providerCode === 60200) res = await this.post("Verifications", { To: e164, Channel: "sms" });
    }
    if (!res.ok) throw await providerError("start", res);
  }

  async check(e164: string, code: string): Promise<CheckResult> {
    const res = await this.post("VerificationCheck", { To: e164, Code: code });
    // 404: the verification expired, was already approved, or hit Twilio's own attempt limit.
    if (res.status === 404 || res.status === 429) return "expired";
    if (!res.ok) throw await providerError("check", res);
    const json = (await res.json()) as { status?: string };
    return json.status === "approved" ? "approved" : "rejected";
  }
}
