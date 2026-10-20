import { MAX_VOUCHER_USDC, pickBrandProducts, validValue } from "./brands";
import { isEvmAddress } from "./money";
import type { InvoiceQuote, InvoiceState, InvoiceStatus, PurchaseSelection, Redemption, VoucherProduct } from "./types";

export class BitrefillError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) {
    super(message);
  }
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

export interface BitrefillConfig {
  /** From docs.bitrefill.com; kept configurable because the docs only name it BASE_URL. */
  baseUrl: string;
  /** Personal key (Bearer) or Business/Affiliate "API_ID:API_SECRET" (Basic). Server-side only. */
  auth: { kind: "bearer"; key: string } | { kind: "basic"; id: string; secret: string };
}

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** Map the provider's invoice status to one the UI can act on. Documented final states: complete, denied, payment_error. */
export function invoiceState(status: string, paymentStatus: string, orders: { status: string; delivered?: boolean }[]): InvoiceState {
  if (status === "denied" || status === "payment_error") return "failed";
  if (status === "complete") {
    // "Finalized, but individual orders may still have failed."
    return orders.length > 0 && orders.every((o) => o.status === "delivered" || o.delivered) ? "delivered" : orders.some((o) => o.status === "failed") ? "failed" : "processing";
  }
  return /unpaid|not_paid|waiting/i.test(paymentStatus) ? "awaiting-payment" : "processing";
}

export class BitrefillClient {
  constructor(private cfg: BitrefillConfig, private doFetch: Fetch = (...a) => fetch(...a)) {}

  private headers(): Record<string, string> {
    const a = this.cfg.auth;
    const authorization = a.kind === "bearer" ? `Bearer ${a.key}` : `Basic ${btoa(`${a.id}:${a.secret}`)}`;
    return { authorization, accept: "application/json", "content-type": "application/json" };
  }

  private async call(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    let res: Response;
    try {
      res = await this.doFetch(this.cfg.baseUrl + path, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new BitrefillError("UPSTREAM_UNREACHABLE", "The voucher provider is unreachable.");
    }
    const text = await res.text();
    let json: Json = {};
    try {
      json = obj(JSON.parse(text));
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) throw new BitrefillError(typeof json.error_code === "string" ? json.error_code : `UPSTREAM_${res.status}`, "The voucher provider rejected the request.", res.status === 429 ? 429 : 502);
    return json;
  }

  /** One page of the catalogue for the given countries (comma-separated ISO codes; "XI" = international). */
  async catalog(countries: string): Promise<VoucherProduct[]> {
    const rows: unknown[] = [];
    // The catalogue is paginated at 50 per page; a handful of pages covers the brands we allow.
    for (let start = 0; start < 400; start += 50) {
      const r = await this.call("GET", `/products?limit=50&start=${start}&country=${encodeURIComponent(countries)}`);
      const page = Array.isArray(r.data) ? r.data : [];
      rows.push(...page);
      if (page.length < 50) break;
    }
    return pickBrandProducts(rows);
  }

  /** Create an UNPAID invoice payable in USDC on Arbitrum. Nothing is charged until USDC is sent to the address. */
  async createInvoice(product: VoucherProduct, sel: PurchaseSelection, refundAddress: string): Promise<InvoiceQuote> {
    if (sel.productId !== product.productId) throw new BitrefillError("BAD_SELECTION", "Unknown product.", 400);
    if (!isEvmAddress(refundAddress)) throw new BitrefillError("BAD_REFUND_ADDRESS", "Invalid refund address.", 400);
    const line: Json = { product_id: product.productId, quantity: 1 };
    if ("packageId" in sel) {
      if (!product.packages.some((p) => String(p.id) === String(sel.packageId))) throw new BitrefillError("BAD_SELECTION", "Unknown denomination.", 400);
      line.package_id = sel.packageId;
    } else {
      if (!validValue(product, sel.value)) throw new BitrefillError("BAD_SELECTION", "That amount is not available.", 400);
      line.value = sel.value;
    }
    const r = await this.call("POST", "/invoices", { products: [line], payment_method: "usdc_arbitrum", refund_address: refundAddress });
    const inv = obj(r.data);
    const pay = obj(inv.payment);
    let price = pay.price;
    if (typeof price === "number" && price > 1000) {
      price = price / 1_000_000;
    }
    // Refuse anything that is not USDC on the expected shape: sending the wrong asset or amount can lose the funds.
    if (typeof inv.id !== "string" || !isEvmAddress(pay.address) || typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new BitrefillError("BAD_INVOICE", "The provider returned an invoice we cannot safely pay.");
    }
    if (typeof pay.currency !== "string" || !/usdc/i.test(pay.currency)) throw new BitrefillError("UNEXPECTED_CURRENCY", "The provider asked for a different currency.");
    if (price > MAX_VOUCHER_USDC) throw new BitrefillError("OVER_LIMIT", "That voucher is above the per-purchase limit.", 400);
    return { invoiceId: inv.id, address: pay.address, price, currency: "USDC" };
  }

  async status(invoiceId: string): Promise<InvoiceStatus> {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(invoiceId)) throw new BitrefillError("BAD_ID", "Invalid invoice id.", 400);
    const inv = obj((await this.call("GET", `/invoices/${invoiceId}`)).data);
    // The docs show `status` and `delivered_time` on orders; accept either as proof of delivery.
    const orders = (Array.isArray(inv.orders) ? inv.orders : []).map((o) => ({ id: String(obj(o).id ?? ""), status: String(obj(o).status ?? ""), delivered: typeof obj(o).delivered_time === "string" && obj(o).delivered_time !== "" }));
    const rawStatus = String(inv.status ?? "");
    const state = invoiceState(rawStatus, String(obj(inv.payment).status ?? ""), orders);
    const redemptions: Redemption[] = [];
    if (state === "delivered") {
      for (const o of orders) {
        const info = obj(obj((await this.call("GET", `/orders/${o.id}`)).data).redemption_info);
        const s = (k: string) => (typeof info[k] === "string" && (info[k] as string) ? (info[k] as string) : undefined);
        redemptions.push({ code: s("code"), link: s("link"), pin: s("pin"), instructions: s("instructions"), expirationDate: s("expiration_date") });
      }
    }
    return { invoiceId, state, rawStatus, redemptions };
  }
}
