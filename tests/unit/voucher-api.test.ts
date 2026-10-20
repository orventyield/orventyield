import { describe, expect, it, vi } from "vitest";
import { VoucherApi, VoucherApiError } from "../../src/lib/vouchers/api";

const api = (status: number, body: unknown) =>
  new VoucherApi("https://w.test", vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);

describe("VoucherApi: not switched on is not an error", () => {
  it("maps an older server without voucher routes (404) to UNAVAILABLE", async () => {
    await expect(api(404, { ok: false, code: "NOT_FOUND", message: "Not found." }).catalog("US")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("maps a server without a provider key (503) to UNAVAILABLE", async () => {
    await expect(api(503, { ok: false, code: "NOT_CONFIGURED", message: "x" }).catalog("US")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("keeps real failures as real errors", async () => {
    const e = await api(502, { ok: false, code: "UPSTREAM_500", message: "The voucher provider had a problem. Nothing was charged." }).catalog("US").catch((x) => x);
    expect(e).toBeInstanceOf(VoucherApiError);
    expect(e.code).toBe("UPSTREAM_500");
  });
  it("returns the catalogue when all is well and reports network failure plainly", async () => {
    expect(await api(200, { ok: true, products: [{ productId: "p" }] }).catalog("US")).toHaveLength(1);
    const down = new VoucherApi("https://w.test", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    await expect(down.catalog("US")).rejects.toMatchObject({ code: "NETWORK" });
  });
});
