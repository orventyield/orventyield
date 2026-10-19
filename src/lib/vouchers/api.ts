import type { InvoiceQuote, InvoiceStatus, PurchaseSelection, VoucherProduct } from "./types";

export class VoucherApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** Browser client for the Worker's /api/vouchers/* routes. No provider credentials are ever present here. */
export class VoucherApi {
  constructor(private baseUrl: string, private doFetch: Fetch = (...a) => fetch(...a)) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(this.baseUrl.replace(/\/$/, "") + path, init);
    } catch {
      throw new VoucherApiError("NETWORK", "Couldn't reach the voucher service. Check your connection.", 0);
    }
    let j: { ok?: boolean; code?: string; message?: string } & T;
    try {
      j = (await res.json()) as typeof j;
    } catch {
      throw new VoucherApiError("BAD_RESPONSE", "The voucher service sent an unexpected reply.", res.status);
    }
    if (!res.ok || j.ok === false) throw new VoucherApiError(j.code ?? `HTTP_${res.status}`, j.message ?? "The voucher service had a problem.", res.status);
    return j;
  }

  async catalog(country: string): Promise<VoucherProduct[]> {
    return (await this.call<{ products: VoucherProduct[] }>(`/api/vouchers/catalog?country=${encodeURIComponent(country)}`)).products ?? [];
  }

  async createInvoice(sel: PurchaseSelection, refundAddress: string, country: string): Promise<InvoiceQuote> {
    const body = { ...sel, refundAddress, country };
    return (await this.call<{ quote: InvoiceQuote }>("/api/vouchers/invoice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).quote;
  }

  async status(invoiceId: string): Promise<InvoiceStatus> {
    return (await this.call<{ status: InvoiceStatus }>(`/api/vouchers/invoice/${encodeURIComponent(invoiceId)}`)).status;
  }
}
