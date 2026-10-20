"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { ARBITRUM } from "@/lib/contracts/arbitrum";
import { CashoutApi, CashoutApiError } from "@/lib/cashout/api";
import { checkOrderForPayment, planCashout, type CashoutPlan } from "@/lib/cashout/plan";
import { AWAITING, DONE_STATUSES, FAILED_STATUSES, type SellOrder } from "@/lib/cashout/types";

export type CashoutStage =
  | { stage: "idle" }
  | { stage: "creating" }
  | { stage: "widget"; widgetUrl: string; plan: CashoutPlan }
  | { stage: "lookup"; widgetUrl: string; plan: CashoutPlan }
  | { stage: "confirm"; plan: CashoutPlan; order: SellOrder; address: Address }
  | { stage: "sending"; plan: CashoutPlan; order: SellOrder }
  | { stage: "sent"; plan: CashoutPlan; order: SellOrder }
  | { stage: "done"; plan: CashoutPlan; order: SellOrder }
  | { stage: "failed"; message: string };

const LOOKUP_TRIES = 10;
const LOOKUP_MS = 2000;
const STATUS_TRIES = 180;
const STATUS_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Deps {
  /** Withdrawable earned yield right now (USDC base units). */
  maxYield: bigint;
  /** Pays exactly `amount` of yield from the Safe to `to` in one transaction; true once confirmed. */
  pay: (amount: bigint, to: Address, label: string) => Promise<boolean>;
  /** Our own contracts and wallets, which must never be a payment destination. */
  forbidden: readonly string[];
  enabled: boolean;
}

/**
 * Bank / UPI cashout: fix the amount to earned yield, open the provider's SELL widget, wait for the order, verify it, then pay it
 * from yield with ONE Safe transaction. Principal is never part of this path.
 */
export function useCashout({ maxYield, pay, forbidden, enabled }: Deps) {
  const baseUrl = process.env.NEXT_PUBLIC_VOUCHER_API_URL || process.env.NEXT_PUBLIC_VERIFY_API_URL;
  const api = useMemo(() => (baseUrl ? new CashoutApi(baseUrl) : null), [baseUrl]);
  const [state, setState] = useState<CashoutStage>({ stage: "idle" });
  const [unavailable, setUnavailable] = useState(false);
  const gen = useRef(0);
  const planRef = useRef<CashoutPlan | null>(null);

  // Is cashout switched on? One cheap call that touches no provider.
  useEffect(() => {
    if (!enabled || !api) return;
    let alive = true;
    void api.available().then((ok) => alive && setUnavailable(!ok));
    return () => {
      alive = false;
    };
  }, [enabled, api]);

  const reset = useCallback(() => {
    gen.current++;
    planRef.current = null;
    setState({ stage: "idle" });
  }, []);

  const fail = (message: string) => setState({ stage: "failed", message });
  const apiMessage = (e: unknown) => (e instanceof CashoutApiError ? (e.code === "UNAVAILABLE" ? "Cashout isn't switched on yet." : e.message) : "Something went wrong. Nothing was sent.");

  /** Step 1: lock the amount to earned yield and open the widget. */
  const start = useCallback(
    async (requestedCents: number | null) => {
      if (!api) return;
      const plan = planCashout(maxYield, requestedCents);
      if (!plan) return fail("There is no earned yield to cash out yet.");
      const my = ++gen.current;
      planRef.current = plan;
      setState({ stage: "creating" });
      try {
        const s = await api.createSession(plan.widgetAmount);
        if (gen.current === my) setState({ stage: "widget", widgetUrl: s.widgetUrl, plan });
      } catch (e) {
        if (e instanceof CashoutApiError && e.code === "UNAVAILABLE") setUnavailable(true);
        if (gen.current === my) fail(apiMessage(e));
      }
    },
    [api, maxYield],
  );

  /** Step 2: the widget reported an order. Look it up from OUR server (never trust the browser message) and verify it. */
  const onOrderCreated = useCallback(
    async (orderId: string) => {
      const plan = planRef.current;
      if (!api || !plan) return;
      const my = gen.current;
      setState((s) => (s.stage === "widget" ? { stage: "lookup", widgetUrl: s.widgetUrl, plan } : s));
      for (let i = 0; i < LOOKUP_TRIES; i++) {
        try {
          const order = await api.getOrder(orderId);
          if (gen.current !== my) return;
          if (FAILED_STATUSES.has(order.status)) return fail("This order was cancelled or expired. Nothing was sent.");
          if (order.status === AWAITING) {
            const check = checkOrderForPayment(order, plan, forbidden);
            if (!check.ok) return fail(check.reason);
            return setState({ stage: "confirm", plan, order, address: check.address });
          }
        } catch (e) {
          if (gen.current !== my) return;
          if (e instanceof CashoutApiError && e.status === 404) {
            /* not visible yet: keep trying */
          } else return fail(apiMessage(e));
        }
        await sleep(LOOKUP_MS);
      }
      if (gen.current === my) fail("We couldn't confirm the order with the provider yet. Nothing was sent.");
    },
    [api, forbidden],
  );

  /** Step 3: one Safe transaction pays exactly the verified amount from yield; then wait for the payout. */
  const send = useCallback(async () => {
    if (state.stage !== "confirm" || !api) return;
    const { plan, order, address } = state;
    const my = gen.current;
    // Re-verify at the moment of sending: nothing may have changed.
    const recheck = checkOrderForPayment(order, plan, forbidden);
    if (!recheck.ok || recheck.address !== address) return fail("The order changed, so we stopped. Nothing was sent.");
    setState({ stage: "sending", plan, order });
    let paid = false;
    try {
      paid = await pay(plan.base, address, "bank cashout");
    } catch {
      paid = false;
    }
    if (gen.current !== my) return;
    if (!paid) {
      // Wallet rejected or the transaction failed: nothing left the Safe, so the order can still be paid.
      setState({ stage: "confirm", plan, order, address });
      return;
    }
    setState({ stage: "sent", plan, order });
    for (let i = 0; i < STATUS_TRIES; i++) {
      await sleep(STATUS_MS);
      if (gen.current !== my) return;
      try {
        const o = await api.getOrder(order.id);
        if (DONE_STATUSES.has(o.status)) return setState({ stage: "done", plan, order: o });
        if (FAILED_STATUSES.has(o.status)) return fail(`The payout ended as ${o.status.toLowerCase()} (reference ${order.id}). Contact support with that reference; your payment was sent.`);
      } catch {
        /* transient: keep polling */
      }
    }
    if (gen.current === my) fail(`The payout is taking longer than expected (reference ${order.id}). Check again later.`);
  }, [state, api, pay, forbidden]);

  return { configured: !!api, unavailable, state, start, onOrderCreated, send, reset };
}

export const CASHOUT_FORBIDDEN = [ARBITRUM.usdc, ARBITRUM.aavePool, ARBITRUM.safeProxyFactory, ARBITRUM.safeL2Singleton, ARBITRUM.safeMultiSendCallOnly, ARBITRUM.safeFallbackHandler] as const;
