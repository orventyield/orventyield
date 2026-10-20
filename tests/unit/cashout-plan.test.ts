import { describe, expect, it } from "vitest";
import { MAX_CASHOUT_USDC, checkOrderForPayment, orderIdFromEvent, parseWidgetMessage, planCashout } from "../../src/lib/cashout/plan";
import { AWAITING, type SellOrder } from "../../src/lib/cashout/types";

describe("planCashout: only earned yield, whole cents", () => {
  it("defaults to all the withdrawable yield, rounded down to cents", () => {
    expect(planCashout(1_908_755n, null)).toEqual({ cents: 190, base: 1_900_000n, widgetAmount: 1.9 });
  });
  it("never exceeds the yield, even if more is requested", () => {
    expect(planCashout(1_000_000n, 99_999)!.cents).toBe(100);
  });
  it("honours a smaller request and floors fractions", () => {
    expect(planCashout(10_000_000n, 250.9)!.cents).toBe(250);
  });
  it("is null for zero yield, dust, zero or junk requests", () => {
    expect(planCashout(0n, null)).toBeNull();
    expect(planCashout(9_999n, null)).toBeNull();
    expect(planCashout(5_000_000n, 0)).toBeNull();
    expect(planCashout(5_000_000n, -3)).toBeNull();
    expect(planCashout(5_000_000n, NaN)).toBeNull();
  });
  it("caps a huge yield at the per-cashout ceiling", () => {
    const p = planCashout(10n ** 15n, null)!;
    expect(p.cents).toBe(MAX_CASHOUT_USDC * 100);
    expect(p.base).toBe(BigInt(MAX_CASHOUT_USDC) * 1_000_000n);
  });
});

const GOOD = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const plan = planCashout(1_900_000n, null)!; // $1.90
const order = (o: Partial<SellOrder> = {}): SellOrder => ({ id: "ord-12345678", status: AWAITING, side: "SELL", cryptoAmount: "1.90", currency: "USDC", network: "arbitrum", depositAddress: GOOD, ...o });

describe("checkOrderForPayment: every condition must hold", () => {
  it("accepts an exact, awaiting SELL of USDC on Arbitrum to a valid address", () => {
    expect(checkOrderForPayment(order(), plan, [])).toEqual({ ok: true, address: GOOD, base: 1_900_000n });
  });
  it("refuses anything else", () => {
    const bad: Partial<SellOrder>[] = [
      { side: "BUY" }, { currency: "ETH" }, { network: "ethereum" }, { status: "COMPLETED" }, { depositAddress: null },
      { depositAddress: "0x123" }, { depositAddress: "0xd8dA6bF26964aF9D7eEd9e03E53415D37aA96045" }, { depositAddress: "0x" + "0".repeat(40) },
      { cryptoAmount: "1.91" }, { cryptoAmount: "1.89" }, { cryptoAmount: "abc" }, { cryptoAmount: "1.9000001" },
    ];
    for (const b of bad) expect(checkOrderForPayment(order(b), plan, []).ok, JSON.stringify(b)).toBe(false);
  });
  it("refuses our own contracts as the destination", () => {
    expect(checkOrderForPayment(order(), plan, [GOOD.toLowerCase()]).ok).toBe(false);
  });
});

describe("widget messages", () => {
  const frame = {};
  it("extracts an order id from several payload shapes, and rejects junk", () => {
    expect(orderIdFromEvent({ id: "abcd-1234-efgh" })).toBe("abcd-1234-efgh");
    expect(orderIdFromEvent({ orderId: "abcd-1234-efgh" })).toBe("abcd-1234-efgh");
    expect(orderIdFromEvent({ status: { id: "abcd-1234-efgh" } })).toBe("abcd-1234-efgh");
    for (const bad of [null, {}, { id: 5 }, { id: "x" }, { id: "../../etc/passwd" }, { id: "a".repeat(80) }]) expect(orderIdFromEvent(bad)).toBeNull();
  });
  it("accepts only messages from the widget frame AND a Transak origin", () => {
    const ok = { origin: "https://global-stg.transak.com", source: frame, data: { event_id: "TRANSAK_ORDER_CREATED", data: { id: "abcd-1234-efgh" } } };
    expect(parseWidgetMessage(ok, frame)).toEqual({ event: "TRANSAK_ORDER_CREATED", orderId: "abcd-1234-efgh" });
    expect(parseWidgetMessage({ ...ok, origin: "https://evil.example" }, frame)).toBeNull();
    expect(parseWidgetMessage({ ...ok, origin: "https://global-stg.transak.com.evil.example" }, frame)).toBeNull();
    expect(parseWidgetMessage({ ...ok, source: {} }, frame)).toBeNull();
    expect(parseWidgetMessage(ok, null)).toBeNull();
    expect(parseWidgetMessage({ ...ok, data: "string" }, frame)).toBeNull();
  });
});
