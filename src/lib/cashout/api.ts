import type { CashoutSession, SellOrder } from "./types";

export class CashoutApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** Browser client for the Worker's /api/cashout/* routes. No provider credentials are ever present here. */
export class CashoutApi {
  constructor(private baseUrl: string, private doFetch: Fetch = (...a) => fetch(...a)) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(this.baseUrl.replace(/\/$/, "") + path, init);
    } catch {
      throw new CashoutApiError("NETWORK", "Couldn't reach the cashout service. Check your connection.", 0);
    }
    let j: { ok?: boolean; code?: string; message?: string } & T;
    try {
      j = (await res.json()) as typeof j;
    } catch {
      throw new CashoutApiError("BAD_RESPONSE", "The cashout service sent an unexpected reply.", res.status);
    }
    // An older server without cashout routes answers NOT_FOUND; one without provider credentials answers 503. Neither is an error.
    if (res.status === 503 || j.code === "NOT_CONFIGURED" || j.code === "NOT_FOUND") {
      throw new CashoutApiError("UNAVAILABLE", "Cashout isn't switched on yet.", res.status);
    }
    if (!res.ok || j.ok === false) throw new CashoutApiError(j.code ?? `HTTP_${res.status}`, j.message ?? "The cashout service had a problem.", res.status);
    return j;
  }

  async createSession(cryptoAmount: number): Promise<CashoutSession> {
    return (await this.call<{ session: CashoutSession }>("/api/cashout/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cryptoAmount }) })).session;
  }

  /** True when the server has cashout switched on. */
  async available(): Promise<boolean> {
    try {
      await this.call("/api/cashout/status");
      return true;
    } catch (e) {
      if (e instanceof CashoutApiError && e.code === "UNAVAILABLE") return false;
      return true; // a network blip is not "switched off"; the real call will report it
    }
  }

  async getOrder(id: string): Promise<SellOrder> {
    return (await this.call<{ order: SellOrder }>(`/api/cashout/order/${encodeURIComponent(id)}`)).order;
  }
}
