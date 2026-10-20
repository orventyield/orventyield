import { describe, expect, it, vi } from "vitest";
import { CashoutApi } from "../../src/lib/cashout/api";

const api = (status: number, body: unknown) => new CashoutApi("https://w.test", vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);

describe("CashoutApi: not switched on is not an error", () => {
  it("treats an older server (NOT_FOUND) and an unconfigured one (503) as unavailable", async () => {
    expect(await api(404, { ok: false, code: "NOT_FOUND" }).available()).toBe(false);
    expect(await api(503, { ok: false, code: "NOT_CONFIGURED" }).available()).toBe(false);
    await expect(api(404, { ok: false, code: "NOT_FOUND" }).createSession(1)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("is available when the server says so, and a network blip does not switch it off", async () => {
    expect(await api(200, { ok: true, available: true }).available()).toBe(true);
    const down = new CashoutApi("https://w.test", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(await down.available()).toBe(true);
    await expect(down.createSession(1)).rejects.toMatchObject({ code: "NETWORK" });
  });
  it("keeps an order-not-found as a normal error and returns sessions and orders", async () => {
    await expect(api(404, { ok: false, code: "ORDER_NOT_FOUND" }).getOrder("ord-12345678")).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", status: 404 });
    expect((await api(200, { ok: true, session: { widgetUrl: "https://global-stg.transak.com?x=1" } }).createSession(1.9)).widgetUrl).toContain("transak");
    expect((await api(200, { ok: true, order: { id: "o" } }).getOrder("ord-12345678")).id).toBe("o");
  });
});
