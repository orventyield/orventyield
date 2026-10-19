/**
 * Browser-side access to the verification service.
 *
 * - RemoteIdentityClient talks to the Worker (NEXT_PUBLIC_VERIFY_API_URL): real SMS, shared registry, the real 1U1C limit.
 * - DemoIdentityClient runs the SAME VerificationService in the browser with an in-memory store, so the Playground has
 *   the full flow (validation, countdowns, rate limits, duplicate rejection) without a server. Its code is always
 *   123456 and its registry lives in this browser only, so it is a demo, not a security boundary.
 */
import type { CheckResult, StartResult } from "./service";

export const DEMO_CODE = "123456";

export class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
    readonly attemptsLeft?: number,
  ) {
    super(message);
  }
}

export interface CheckParams {
  phone: string;
  code: string;
  owner: string;
  nonce: string;
  signature?: string;
}

export interface IdentityClient {
  readonly mode: "remote" | "demo";
  status(owner: string): Promise<boolean>;
  start(phone: string, owner: string): Promise<StartResult>;
  check(p: CheckParams): Promise<CheckResult>;
}

const TIMEOUT_MS = 12_000;

export class RemoteIdentityClient implements IdentityClient {
  readonly mode = "remote" as const;
  constructor(private baseUrl: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, { ...init, signal: ctrl.signal });
    } catch {
      throw new ClientError("NETWORK", "Can't reach the verification service. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || body.ok === false) {
      throw new ClientError(
        typeof body.code === "string" ? body.code : "ERROR",
        typeof body.message === "string" ? body.message : "Something went wrong. Please try again.",
        typeof body.retryAfterSec === "number" ? body.retryAfterSec : undefined,
        typeof body.attemptsLeft === "number" ? body.attemptsLeft : undefined,
      );
    }
    return body as T;
  }

  async status(owner: string) {
    const r = await this.call<{ active: boolean }>(`/api/verify/status?owner=${encodeURIComponent(owner)}`);
    return r.active;
  }
  start(phone: string, owner: string) {
    return this.call<StartResult>("/api/verify/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, owner }),
    });
  }
  check(p: CheckParams) {
    return this.call<CheckResult>("/api/verify/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
  }
}

export async function createIdentityClient(apiUrl: string | undefined): Promise<IdentityClient> {
  if (apiUrl) return new RemoteIdentityClient(apiUrl);
  const { DemoIdentityClient } = await import("./demoClient");
  return new DemoIdentityClient();
}
