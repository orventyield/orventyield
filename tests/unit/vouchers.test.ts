import { describe, expect, it, vi } from "vitest";
import { BitrefillClient, BitrefillError, invoiceState } from "../../src/lib/vouchers/bitrefill";
import { MAX_VOUCHER_USDC, pickBrandProducts, validValue } from "../../src/lib/vouchers/brands";
import { isEvmAddress, usdcBaseUnitsCeil } from "../../src/lib/vouchers/money";
import type { VoucherProduct } from "../../src/lib/vouchers/types";

const row = (name: string, extra: Record<string, unknown> = {}) => ({
  id: name.toLowerCase().replace(/\W+/g, "-"), name, country_code: "IN", currency: "INR", in_stock: true,
  image: "https://cdn.bitrefill.com/x.webp", packages: [{ id: 1, value: 500, price: 6 }, { id: 2, value: 1000, price: 12 }], ...extra,
});

describe("brand picking", () => {
  it("finds the four brands in a mixed catalogue, in a stable order", () => {
    const p = pickBrandProducts([row("Netflix"), row("Uber Eats"), row("Zomato"), row("Amazon.in"), row("Swiggy"), row("Uber")]);
    expect(p.map((x) => x.brand)).toEqual(["amazon", "swiggy", "zomato", "uber"]);
    expect(p.find((x) => x.brand === "uber")!.name).toBe("Uber"); // not Uber Eats
  });
  it("skips out-of-stock, empty and malformed rows, and non-https images", () => {
    const p = pickBrandProducts([row("Amazon", { in_stock: false }), row("Swiggy", { packages: [] }), null as never, { name: 5 }, row("Zomato", { image: "http://evil/x.png" })]);
    expect(p.map((x) => x.brand)).toEqual(["zomato"]);
    expect(p[0]!.image).toBeUndefined();
  });
  it("keeps the first product per brand and supports ranged products", () => {
    const p = pickBrandProducts([row("Amazon US", { country_code: "US" }), row("Amazon.in"), row("Uber", { packages: [], range: { min: 10, max: 100, step: 5 } })]);
    expect(p.find((x) => x.brand === "amazon")!.countryCode).toBe("US");
    expect(p.find((x) => x.brand === "uber")!.range).toEqual({ min: 10, max: 100, step: 5 });
  });
  it("validates denominations against packages and ranges", () => {
    const [u] = pickBrandProducts([row("Uber", { packages: [{ id: 9, value: 25 }], range: { min: 10, max: 100, step: 5 } })]);
    expect(validValue(u!, 25)).toBe(true);
    expect(validValue(u!, 15)).toBe(true);
    expect(validValue(u!, 17)).toBe(false);
    expect(validValue(u!, 5)).toBe(false);
    expect(validValue(u!, 101)).toBe(false);
    for (const bad of [0, -1, NaN, Infinity]) expect(validValue(u!, bad)).toBe(false);
  });
});

describe("usdcBaseUnitsCeil", () => {
  it("never rounds down (under-paying can lose funds) and ignores float noise", () => {
    expect(usdcBaseUnitsCeil(25.31)).toBe(25_310_000n);
    expect(usdcBaseUnitsCeil(0.1 + 0.2)).toBe(300_000n);
    expect(usdcBaseUnitsCeil(1.0000001)).toBe(1_000_001n);
    expect(usdcBaseUnitsCeil(0.000001)).toBe(1n); // dust
  });
  it("rejects unsafe values and enforces the ceiling", () => {
    for (const bad of [0, -5, NaN, Infinity, "5", null, undefined, MAX_VOUCHER_USDC + 0.01]) expect(usdcBaseUnitsCeil(bad)).toBeNull();
    expect(usdcBaseUnitsCeil(MAX_VOUCHER_USDC)).toBe(BigInt(MAX_VOUCHER_USDC) * 1_000_000n); // max
  });
  it("checks addresses, including the checksum of mixed-case ones", () => {
    expect(isEvmAddress("0x" + "a".repeat(40))).toBe(true);
    expect(isEvmAddress("0xb0b0000000000000000000000000000000000b0b")).toBe(true); // all lowercase
    expect(isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true); // valid checksum
    expect(isEvmAddress("0xd8dA6bF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false); // one letter's case flipped: broken checksum
    for (const bad of ["0x123", "a".repeat(42), 5, null]) expect(isEvmAddress(bad)).toBe(false);
  });
});

describe("invoiceState", () => {
  it("maps documented final states", () => {
    expect(invoiceState("denied", "", [])).toBe("failed");
    expect(invoiceState("payment_error", "", [])).toBe("failed");
    expect(invoiceState("complete", "paid", [{ status: "delivered" }])).toBe("delivered");
    expect(invoiceState("complete", "paid", [{ status: "created", delivered: true }])).toBe("delivered");
    expect(invoiceState("complete", "paid", [{ status: "failed" }])).toBe("failed");
    expect(invoiceState("complete", "paid", [{ status: "created" }])).toBe("processing");
    expect(invoiceState("complete", "paid", [])).toBe("processing");
  });
  it("tells unpaid from processing", () => {
    expect(invoiceState("not_delivered", "unpaid", [])).toBe("awaiting-payment");
    expect(invoiceState("not_delivered", "paid", [])).toBe("processing");
  });
});

const ADDR = "0x" + "b".repeat(40);
const product: VoucherProduct = { brand: "swiggy", productId: "swiggy", name: "Swiggy", countryCode: "IN", currency: "INR", packages: [{ id: 1, value: 500 }] };
const mk = (routes: Record<string, (init: RequestInit) => unknown>, auth: ConstructorParameters<typeof BitrefillClient>[0]["auth"] = { kind: "bearer", key: "K" }) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method} ${url.replace("https://api.test/v2", "").split("?")[0]}`;
    const h = routes[key];
    if (!h) return new Response("{}", { status: 404 });
    const out = h(init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 });
  });
  return { c: new BitrefillClient({ baseUrl: "https://api.test/v2", auth }, f as unknown as typeof fetch), calls };
};

describe("BitrefillClient", () => {
  it("sends Bearer for personal keys and Basic for business credentials", async () => {
    const a = mk({ "GET /products": () => ({ body: { data: [] } }) });
    await a.c.catalog("IN");
    expect((a.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer K");
    const b = mk({ "GET /products": () => ({ body: { data: [] } }) }, { kind: "basic", id: "id", secret: "sec" });
    await b.c.catalog("IN");
    expect((b.calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("id:sec")}`);
  });

  it("pages the catalogue until a short page", async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => row(`Filler ${i}`));
    let n = 0;
    const { c, calls } = mk({ "GET /products": () => ({ body: { data: n++ === 0 ? page(50) : [row("Zomato")] } }) });
    expect((await c.catalog("IN")).map((p) => p.brand)).toEqual(["zomato"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain("start=50");
  });

  it("creates a USDC-on-Arbitrum invoice and returns the exact payment details", async () => {
    const { c, calls } = mk({ "POST /invoices": () => ({ body: { data: { id: "inv_123456", payment: { address: ADDR, price: 6.02, currency: "USDC" } } } }) });
    const q = await c.createInvoice(product, { productId: "swiggy", packageId: 1 }, ADDR);
    expect(q).toEqual({ invoiceId: "inv_123456", address: ADDR, price: 6.02, currency: "USDC" });
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.payment_method).toBe("usdc_arbitrum");
    expect(sent.refund_address).toBe(ADDR);
    expect(sent.products).toEqual([{ product_id: "swiggy", quantity: 1, package_id: 1 }]);
  });

  it("refuses invoices it cannot safely pay: wrong currency, bad address, zero or huge price", async () => {
    const bad = async (payment: unknown) => {
      const { c } = mk({ "POST /invoices": () => ({ body: { data: { id: "inv_123456", payment } } }) });
      return c.createInvoice(product, { productId: "swiggy", packageId: 1 }, ADDR).catch((e: BitrefillError) => e.code);
    };
    expect(await bad({ address: ADDR, price: 6, currency: "BTC" })).toBe("UNEXPECTED_CURRENCY");
    expect(await bad({ address: "0x1", price: 6, currency: "USDC" })).toBe("BAD_INVOICE");
    expect(await bad({ address: ADDR, price: 0, currency: "USDC" })).toBe("BAD_INVOICE");
    expect(await bad({ address: ADDR, price: MAX_VOUCHER_USDC + 1, currency: "USDC" })).toBe("OVER_LIMIT");
  });

  it("rejects bad selections before calling the provider", async () => {
    const { c, calls } = mk({});
    await expect(c.createInvoice(product, { productId: "other", packageId: 1 }, ADDR)).rejects.toMatchObject({ code: "BAD_SELECTION" });
    await expect(c.createInvoice(product, { productId: "swiggy", packageId: 99 }, ADDR)).rejects.toMatchObject({ code: "BAD_SELECTION" });
    await expect(c.createInvoice(product, { productId: "swiggy", value: 7 }, ADDR)).rejects.toMatchObject({ code: "BAD_SELECTION" });
    await expect(c.createInvoice(product, { productId: "swiggy", packageId: 1 }, "nope")).rejects.toMatchObject({ code: "BAD_REFUND_ADDRESS" });
    expect(calls).toHaveLength(0);
  });

  it("returns redemption details only once delivered", async () => {
    const inv = (status: string, orderStatus: string) => ({ body: { data: { id: "inv_123456", status, payment: { status: "paid" }, orders: [{ id: "ord1", status: orderStatus }] } } });
    const wait = mk({ "GET /invoices/inv_123456": () => inv("not_delivered", "created") });
    expect((await wait.c.status("inv_123456")).redemptions).toEqual([]);
    const done = mk({
      "GET /invoices/inv_123456": () => inv("complete", "delivered"),
      "GET /orders/ord1": () => ({ body: { data: { redemption_info: { code: "ABCD-1234", pin: "99", instructions: "Use it.", expiration_date: "2027-01-01" } } } }),
    });
    const s = await done.c.status("inv_123456");
    expect(s.state).toBe("delivered");
    expect(s.redemptions).toEqual([{ code: "ABCD-1234", link: undefined, pin: "99", instructions: "Use it.", expirationDate: "2027-01-01" }]);
  });

  it("validates invoice ids and maps upstream failures", async () => {
    const { c } = mk({ "GET /invoices/inv_123456": () => ({ status: 500, body: {} }) });
    await expect(c.status("../etc/passwd")).rejects.toMatchObject({ code: "BAD_ID", status: 400 });
    await expect(c.status("inv_123456")).rejects.toMatchObject({ code: "UPSTREAM_500" });
  });
});
