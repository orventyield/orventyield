import type { Card, CardSecrets, CardReadiness, FundingSource, ImmersveConfig, Prerequisite, Region, Session } from "./types";

export class ImmersveError extends Error {
  constructor(readonly status: number, readonly errorCode: string, message?: string) {
    super(message ?? `${errorCode} (HTTP ${status})`);
    this.name = "ImmersveError";
  }
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

const str = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !v) throw new ImmersveError(502, "BAD_RESPONSE", `Immersve response is missing "${field}"`);
  return v;
};

/**
 * Wallet-session client (non-custodial). Runs in the browser with the user's session token.
 * It holds NO API keys or secrets; issuer/admin keys must stay on a server we control.
 * Card secrets (PAN/CVV) are fetched straight from Immersve into the browser, as Immersve's PCI guidance requires.
 */
export class ImmersveClient {
  private session: Session | null = null;

  constructor(
    private readonly cfg: ImmersveConfig,
    private readonly doFetch: Fetch = (...a) => fetch(...a),
  ) {}

  get isLoggedIn(): boolean {
    return this.session !== null;
  }
  get accountId(): string {
    return this.requireSession().cardholderAccountId;
  }

  private requireSession(): Session {
    if (!this.session) throw new ImmersveError(401, "NOT_LOGGED_IN", "Sign in with your wallet first");
    return this.session;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: Json, auth = true): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) headers.authorization = `Bearer ${this.requireSession().accessToken}`;
    const res = await this.doFetch(this.cfg.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON (e.g. gateway 403 page) */
    }
    if (!res.ok) {
      const code = (json as Json | null)?.errorCode;
      throw new ImmersveError(res.status, typeof code === "string" ? code : `HTTP_${res.status}`);
    }
    return json as T;
  }

  /** SIWE login. `sign` signs the EIP-4361 message with the user's wallet (EOA). */
  async login(address: string, origin: string, sign: (message: string) => Promise<string>): Promise<Session> {
    const init = await this.request<{ id: string; signingChallenge: { message: string } }>(
      "POST",
      "/auth/login-init",
      {
        loginMethod: "siwe",
        network: this.cfg.network,
        clientApplicationId: this.cfg.clientApplicationId,
        scopes: ["cardholder-partner"],
        address,
        url: origin,
        autoSignup: true,
      },
      false,
    );
    const signature = await sign(str(init.signingChallenge?.message, "signingChallenge.message"));
    const done = await this.request<Json>("POST", "/auth/login-complete", { loginRequestId: str(init.id, "id"), signature }, false);
    this.session = {
      accessToken: str(done.accessToken, "accessToken"),
      refreshToken: str(done.refreshToken, "refreshToken"),
      cardholderAccountId: str(done.cardholderAccountId, "cardholderAccountId"),
    };
    return this.session;
  }

  logout(): void {
    this.session = null;
  }

  async supportedRegions(): Promise<Region[]> {
    const r = await this.request<{ regions: Region[] }>("GET", `/api/accounts/${this.cfg.partnerAccountId}/supported-regions`);
    return r.regions ?? [];
  }

  async listFundingSources(): Promise<FundingSource[]> {
    const r = await this.request<{ items: FundingSource[] }>("GET", `/api/accounts/${this.accountId}/funding-sources`);
    return r.items ?? [];
  }

  /** Idempotent: returns the existing source for this channel when one already exists. */
  async ensureFundingSource(fundingAddress: string): Promise<FundingSource> {
    const existing = (await this.listFundingSources()).find((f) => f.fundingChannelId === this.cfg.fundingChannelId);
    if (existing) return existing;
    return this.request<FundingSource>("POST", "/api/funding-sources", {
      accountId: this.accountId,
      fundingAddress,
      fundingChannelId: this.cfg.fundingChannelId,
    });
  }

  /** `redirectUrl` must be https (Immersve's gateway rejects http://localhost with an HTML 403). */
  async spendingPrerequisites(fundingSourceId: string, spendableAmountMinor: number, redirectUrl: string): Promise<Prerequisite[]> {
    const r = await this.request<{ prerequisites: Prerequisite[] }>("POST", "/api/spending-prerequisites", {
      cardProgramId: this.cfg.cardProgramId,
      fundingSourceId,
      spendableAmount: spendableAmountMinor,
      spendableCurrency: "USD",
      kycType: "immersve-conducted",
      kycRedirectUrl: redirectUrl,
    });
    return r.prerequisites ?? [];
  }

  async createCard(fundingSourceId: string): Promise<string> {
    const r = await this.request<{ cardId: string }>("POST", "/api/cards", {
      cardProgramId: this.cfg.cardProgramId,
      fundingSourceId,
    });
    return str(r.cardId, "cardId");
  }

  getCard(cardId: string): Promise<Card> {
    return this.request<Card>("GET", `/api/cards/${cardId}`);
  }

  /** Two steps: single-use token, then a single-use callback URL. Reuse returns 403. */
  async revealCard(cardId: string): Promise<CardSecrets> {
    const tok = await this.request<{ callbackUrl: string }>("POST", `/api/cards/${cardId}/pan-token`, {});
    const res = await this.doFetch(str(tok.callbackUrl, "callbackUrl"));
    if (!res.ok) throw new ImmersveError(res.status, "REVEAL_FAILED");
    const d = (await res.json()) as Json;
    return {
      pan: str(d.pan, "pan"),
      expiry: str(d.expiry, "expiry"),
      cvv2: str(d.cvv2, "cvv2"),
      embossedName: typeof d.embossedName === "string" ? d.embossedName : "",
    };
  }
}

/** Turn the raw prerequisite list into the one next step the UI should show. */
export function readiness(prereqs: Prerequisite[]): CardReadiness {
  const kyc = prereqs.find((p) => p.stage === "kyc");
  if (kyc && kyc.status !== "ok") {
    const url = kyc.params?.kycUrl;
    return kyc.status === "pending" || !url ? { state: "pending" } : { state: "kyc-required", kycUrl: url };
  }
  if (prereqs.some((p) => p.stage === "aml" && p.status !== "ok")) return { state: "pending" };
  if (prereqs.some((p) => p.stage === "funding" && p.status !== "ok")) return { state: "funding-required" };
  return { state: "ready" };
}

/** Mask a PAN for logs and toasts: first 6 + last 4 only. */
export const maskPan = (pan: string): string => (pan.length < 10 ? "****" : `${pan.slice(0, 6)}${"*".repeat(pan.length - 10)}${pan.slice(-4)}`);
