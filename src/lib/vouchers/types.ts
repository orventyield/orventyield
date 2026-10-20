/** Shapes follow docs.bitrefill.com (products, invoices, orders). Only the fields we use. */

export type BrandId = "amazon" | "flipkart" | "swiggy" | "zomato" | "uber";

export interface VoucherPackage {
  id: string | number;
  /** Face value in the product's own currency (e.g. 500 INR). */
  value: number;
}

export interface VoucherRange {
  min: number;
  max: number;
  step: number;
}

export interface VoucherProduct {
  brand: BrandId;
  productId: string;
  name: string;
  countryCode: string;
  /** Currency of the face value, e.g. "INR". */
  currency: string;
  image?: string;
  packages: VoucherPackage[];
  range?: VoucherRange;
}

export type PurchaseSelection = { productId: string } & ({ packageId: string | number } | { value: number });

export interface InvoiceQuote {
  invoiceId: string;
  /** Where to send the USDC (Arbitrum). */
  address: string;
  /** Exact USDC amount to send, as returned by the provider. */
  price: number;
  currency: string;
}

export type InvoiceState = "awaiting-payment" | "processing" | "delivered" | "failed";

export interface Redemption {
  code?: string;
  link?: string;
  pin?: string;
  instructions?: string;
  expirationDate?: string;
}

export interface InvoiceStatus {
  invoiceId: string;
  state: InvoiceState;
  /** Provider's raw invoice status, for support requests. */
  rawStatus: string;
  redemptions: Redemption[];
}
