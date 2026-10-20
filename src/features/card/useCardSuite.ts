"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useIdentity } from "@/features/identity/IdentityProvider";
import type { Address } from "viem";
import { ARBITRUM } from "@/lib/contracts/arbitrum";
import { ImmersveClient, ImmersveError, immersveConfig, readiness, type Card, type CardReadiness, type CardSecrets, type CardTransaction } from "@/lib/immersve";
import { baseToCents, centsToBase, fundingAction, fundsStorageFor, planTopUp, withdrawalAction, type FundingAction } from "@/lib/immersve/funding";
import type { Hex } from "viem";
import { deriveStage, type CardStage } from "@/lib/immersve/stage";

const REVEAL_SECONDS = 30;
const POLL_MS = 6000;
/** After a deposit, how long we wait for the issuer to credit the funding source. */
const CREDIT_TRIES = 40;
const CREDIT_POLL_MS = 3000;
/** Immersve asks for an expected spend amount during onboarding; never declare less than $1.00. */
const MIN_DECLARED_CENTS = 100;

const cacheKey = (owner: string) => `oy.card.${owner}`;
const readFlag = (k: string) => {
  try {
    return window.localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (k: string, v: boolean) => {
  try {
    if (v) window.localStorage.setItem(k, "1");
    else window.localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
};

/** https is mandatory for the KYC return URL (Immersve's gateway rejects http://localhost). */
function kycReturnUrl(): string {
  return window.location.protocol === "https:" ? `${window.location.origin}/dashboard` : "https://orventyield.tech/dashboard";
}

export function friendlyCardError(e: unknown): string {
  const x = e as { name?: string; code?: number; shortMessage?: string; message?: string } | null;
  const msg = `${x?.shortMessage ?? ""} ${x?.message ?? ""}`.toLowerCase();
  if (x?.code === 4001 || (x?.name ?? "").includes("UserRejected") || msg.includes("user rejected") || msg.includes("user denied")) {
    return "You cancelled the signature in your wallet. Nothing was sent and no fee was charged.";
  }
  if (e instanceof ImmersveError) {
    switch (e.errorCode) {
      case "KYC_REQUIRED":
        return "Identity verification isn't finished yet.";
      case "NOT_LOGGED_IN":
        return "Your card session expired. Continue again to sign in.";
      case "REVEAL_FAILED":
        return "The one-time card link was already used or expired. Tap reveal again for a fresh one.";
      case "UNSUPPORTED_WITHDRAWAL":
      case "UNSUPPORTED_FUNDING":
      case "BAD_FUNDS_ADDRESS":
      case "FUNDING_MISMATCH":
        return e.message;
      case "UNSAFE_URL":
        return "The card issuer sent an address we don't trust, so we stopped. Nothing was sent.";
      default:
        if (e.status === 401) return "Your card session expired. Continue again to sign in.";
        if (e.status >= 500 || e.status === 502) return "The card provider is unavailable right now. Try again in a moment.";
        return `The card provider declined the request (${e.errorCode}).`;
    }
  }
  return "Something went wrong. Nothing was charged. Please try again.";
}

/**
 * The unified card flow: phone OTP (1 phone = 1 card) -> card provider session -> KYC -> issue -> active card with a
 * single-use PAN/CVV reveal -> fund the card from earned yield. `maxYield` is the yield that can be withdrawn right now
 * (USDC, 6 decimals). Funding withdraws exactly that much yield from Aave and deposits it to the issuer; the card can
 * then spend its funded balance, never more, and never principal.
 */
export function useCardSuite({ maxYield, pay, exec }: { maxYield: bigint; pay: (amount: bigint, to: Address, label: string) => Promise<boolean>; exec: (calls: { to: Address; data: Hex }[], label: string, detail: string) => Promise<boolean> }) {
  const { address, isConnected } = useAccount();
  const { client: identity, owner: identityOwner, isWallet, sign } = useIdentity();
  const imsv = useRef<ImmersveClient | null>(null);
  const cfg = useRef(immersveConfig());
  if (imsv.current === null) imsv.current = new ImmersveClient(cfg.current);
  const isSandbox = cfg.current.baseUrl !== "https://api.immersve.com";

  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [ready, setReady] = useState<CardReadiness | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [fundingSourceId, setFundingSourceId] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<CardSecrets | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState<"login" | "kyc" | "issue" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balanceBase, setBalanceBase] = useState<bigint | null>(null);
  const [cardTransactions, setCardTransactions] = useState<CardTransaction[]>([]);
  const [withdrawal, setWithdrawal] = useState<{ busy: boolean; error: string | null; done: string | null; steps: "api" | "chain" | null }>({ busy: false, error: null, done: null, steps: null });
  const [fundingKind, setFundingKind] = useState<FundingAction["kind"] | null>(null);
  const [funding, setFunding] = useState<{ busy: boolean; error: string | null; done: string | null; steps: "api" | "chain" | null }>({ busy: false, error: null, done: null, steps: null });

  const cents = baseToCents(maxYield);
  const walletConnected = isConnected && !!address && isWallet;

  // 1. Phone verification status (instant from cache, confirmed by the verification service).
  useEffect(() => {
    if (!walletConnected || !identity || !identityOwner) {
      setPhoneVerified(null);
      return;
    }
    let alive = true;
    const cached = readFlag(cacheKey(identityOwner));
    setPhoneVerified(cached ? true : null);
    identity
      .status(identityOwner)
      .then((active) => {
        if (!alive) return;
        setPhoneVerified(active);
        writeFlag(cacheKey(identityOwner), active);
      })
      .catch(() => alive && setPhoneVerified(cached)); // offline: trust the cache, otherwise ask them to verify
    return () => {
      alive = false;
    };
  }, [walletConnected, identity, identityOwner]);

  // A different wallet must never inherit the previous wallet's card session or revealed secrets.
  useEffect(() => {
    imsv.current!.logout();
    setSessionActive(false);
    setReady(null);
    setCards(null);
    setFundingSourceId(null);
    setBalanceBase(null);
    setCardTransactions([]);
    setSecrets(null);
    setError(null);
    setFunding({ busy: false, error: null, done: null, steps: null });
  }, [address]);

  const refresh = useCallback(async () => {
    const c = imsv.current!;
    if (!c.isLoggedIn || !address) return;
    try {
      // OPEN ITEM for production deposit mode: deposits come from the Safe, so the funding source must be created for the
      // Safe's address (Immersve: a smart contract wallet implementing ERC-1271 is allowed, proved with a signed challenge from
      // POST /api/challenges). Until that is verified against a real partner account, the funding source uses the login wallet.
      const fs = fundingSourceId ? { id: fundingSourceId } : await c.ensureFundingSource(address);
      setFundingSourceId(fs.id);
      const [prereqs, list, source, txs] = await Promise.all([
        c.spendingPrerequisites(fs.id, Math.max(cents, MIN_DECLARED_CENTS), kycReturnUrl()),
        c.listCards(),
        c.getFundingSource(fs.id),
        c.listTransactions().catch(() => [] as CardTransaction[]), // the ledger is nice to have, never a blocker
      ]);
      setReady(readiness(prereqs));
      setCards(list);
      setBalanceBase(/^\d+$/.test(source.balance) ? BigInt(source.balance) : 0n);
      setCardTransactions(txs);
    } catch (e) {
      if (e instanceof ImmersveError && (e.status === 401 || e.errorCode === "NOT_LOGGED_IN")) setSessionActive(false);
      setError(friendlyCardError(e));
    }
  }, [address, fundingSourceId, cents]);

  const stage: CardStage = useMemo(
    () => deriveStage({ walletConnected, phoneVerified, sessionActive, readiness: ready, cards }),
    [walletConnected, phoneVerified, sessionActive, ready, cards],
  );

  // 2. Poll while the user is finishing KYC in another tab or the checks are running.
  useEffect(() => {
    if (stage.stage !== "kyc" && stage.stage !== "pending") return;
    const id = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stage.stage, refresh]);

  // Revealed secrets disappear after 30 seconds and whenever the component goes away.
  useEffect(() => {
    if (!secrets) return;
    setSecondsLeft(REVEAL_SECONDS);
    const id = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    const t = setTimeout(() => setSecrets(null), REVEAL_SECONDS * 1000);
    return () => {
      clearInterval(id);
      clearTimeout(t);
    };
  }, [secrets]);
  useEffect(() => () => setSecrets(null), []);

  const markPhoneVerified = useCallback(() => {
    if (identityOwner) writeFlag(cacheKey(identityOwner), true);
    setPhoneVerified(true);
  }, [identityOwner]);

  const connectProvider = useCallback(async () => {
    if (!address) return;
    setBusy("login");
    setError(null);
    try {
      await imsv.current!.login(address, window.location.origin, sign);
      setSessionActive(true);
      await refresh();
    } catch (e) {
      setError(friendlyCardError(e));
    } finally {
      setBusy(null);
    }
  }, [address, sign, refresh]);

  // After login flips sessionActive, make sure data is loaded even if refresh ran before the state settled.
  useEffect(() => {
    if (sessionActive && ready === null && cards === null) void refresh();
  }, [sessionActive, ready, cards, refresh]);

  const openKyc = useCallback((url: string) => {
    setBusy("kyc");
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => setBusy(null), 800);
  }, []);

  const issueCard = useCallback(async () => {
    if (!fundingSourceId) return;
    setBusy("issue");
    setError(null);
    try {
      await imsv.current!.createCard(fundingSourceId);
      await refresh();
    } catch (e) {
      setError(friendlyCardError(e));
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [fundingSourceId, refresh]);

  const reveal = useCallback(async () => {
    if (stage.stage !== "active") return;
    setBusy("reveal");
    setError(null);
    try {
      setSecrets(await imsv.current!.revealCard(stage.card.id));
    } catch (e) {
      setError(friendlyCardError(e));
    } finally {
      setBusy(null);
    }
  }, [stage]);

  /** Ask the issuer how it wants to be funded, so the dialog can say exactly what will happen before anything is sent. */
  const probeFunding = useCallback(async () => {
    const c = imsv.current!;
    setFundingKind(null);
    if (!c.isLoggedIn || !fundingSourceId || balanceBase === null) return;
    const plan = planTopUp(maxYield, balanceBase, null);
    if (!plan) return;
    try {
      setFundingKind(fundingAction(await c.spendingPrerequisites(fundingSourceId, plan.targetCents, kycReturnUrl())).kind);
    } catch {
      setFundingKind("unsupported");
    }
  }, [fundingSourceId, balanceBase, maxYield]);

  /**
   * Put earned yield on the card. Never more than the yield that can be withdrawn, whole cents only.
   * Sandbox: the issuer's simulator credits the balance (no real money moves). Production deposit mode: ONE Safe
   * transaction withdraws exactly that yield from Aave and transfers it to the issuer's funds address.
   */
  const fund = useCallback(
    async (requestedCents: number | null): Promise<boolean> => {
      const c = imsv.current!;
      if (funding.busy || !c.isLoggedIn || !fundingSourceId || balanceBase === null) return false;
      const plan = planTopUp(maxYield, balanceBase, requestedCents);
      if (!plan) {
        setFunding({ busy: false, error: "There is no earned yield to put on the card yet.", done: null, steps: null });
        return false;
      }
      setFunding({ busy: true, error: null, done: null, steps: null });
      try {
        const action = fundingAction(await c.spendingPrerequisites(fundingSourceId, plan.targetCents, kycReturnUrl()));
        if (action.kind === "funded") {
          setFunding({ busy: false, error: null, done: "Your card already has this much on it.", steps: null });
          return true;
        }
        if (action.kind === "unsupported") throw new ImmersveError(422, "UNSUPPORTED_FUNDING", `The card issuer asked for a funding step we don't support yet (${action.actionType}). Nothing was sent.`);

        if (action.kind === "simulator") {
          if (!isSandbox) throw new ImmersveError(422, "UNSUPPORTED_FUNDING", "Sandbox funding is not available here. Nothing was sent.");
          // The issuer computes the shortfall; refuse if it is not exactly what we planned.
          if (action.payload.amount !== plan.base.toString() || action.payload.fundingSourceId !== fundingSourceId) {
            throw new ImmersveError(422, "FUNDING_MISMATCH", "The amount the issuer asked for does not match what we planned, so we stopped. Nothing was sent.");
          }
          setFunding((f) => ({ ...f, steps: "api" }));
          await c.executeSimulatorDeposit(action.url, action.payload);
        } else {
          // Production deposit mode: the transfer goes to the funding channel's Funds Storage address, checked below.
          const channel = await c.getFundingChannel(cfg.current.fundingChannelId);
          if (channel.mode !== "deposit") throw new ImmersveError(422, "UNSUPPORTED_FUNDING", `This funding channel works in "${channel.mode}" mode, which we don't support yet. Nothing was sent.`);
          const target = fundsStorageFor(channel, cfg.current, [ARBITRUM.usdc, ARBITRUM.aavePool, ARBITRUM.safeProxyFactory, ARBITRUM.safeL2Singleton, ARBITRUM.safeMultiSendCallOnly, address ?? ""]);
          if (!target.ok) throw new ImmersveError(422, "BAD_FUNDS_ADDRESS", target.reason);
          setFunding((f) => ({ ...f, steps: "chain" }));
          const sent = await pay(plan.base, target.address, "card funding");
          if (!sent) {
            // The wallet was rejected or the transaction failed: nothing left the Safe.
            setFunding({ busy: false, error: "The funding transaction was not completed. Nothing was added to your card.", done: null, steps: null });
            return false;
          }
        }

        // The issuer credits the funding source once the deposit is confirmed.
        const want = balanceBase + plan.base;
        for (let i = 0; i < CREDIT_TRIES; i++) {
          const src = await c.getFundingSource(fundingSourceId);
          const now = /^\d+$/.test(src.balance) ? BigInt(src.balance) : 0n;
          setBalanceBase(now);
          if (now >= want) {
            setFunding({ busy: false, error: null, done: `Added $${(plan.cents / 100).toFixed(2)} of earned yield to your card.`, steps: action.kind === "simulator" ? "api" : "chain" });
            void refresh();
            return true;
          }
          await new Promise((r) => setTimeout(r, CREDIT_POLL_MS));
        }
        setFunding({ busy: false, error: "Your deposit was sent but the issuer hasn't credited it yet. It will appear on your card once it is confirmed.", done: null, steps: null });
        return false;
      } catch (e) {
        setFunding({ busy: false, error: friendlyCardError(e), done: null, steps: null });
        return false;
      }
    },
    [funding.busy, fundingSourceId, balanceBase, maxYield, isSandbox, pay, address, refresh],
  );

  /**
   * Take money back off the card, into the Safe. The issuer debits the card at once. Sandbox: its simulator confirms. On a real
   * chain: ONE Safe transaction calls withdraw() on the issuer's funds contract (strictly validated) and the USDC lands in the Safe.
   */
  const withdrawToSafe = useCallback(
    async (requestedCents: number | null): Promise<boolean> => {
      const c = imsv.current!;
      if (withdrawal.busy || !c.isLoggedIn || !fundingSourceId || balanceBase === null) return false;
      const maxCents = baseToCents(balanceBase);
      const cents = requestedCents === null ? maxCents : Math.min(Math.floor(requestedCents), maxCents);
      if (!Number.isFinite(cents) || cents <= 0) {
        setWithdrawal({ busy: false, error: "There is nothing on the card to withdraw.", done: null, steps: null });
        return false;
      }
      const base = centsToBase(cents);
      setWithdrawal({ busy: true, error: null, done: null, steps: null });
      try {
        const intent = await c.createWithdrawalIntent(fundingSourceId, base);
        const channel = await c.getFundingChannel(cfg.current.fundingChannelId);
        const action = withdrawalAction(intent, channel, cfg.current, [ARBITRUM.usdc, ARBITRUM.aavePool, ARBITRUM.safeProxyFactory, ARBITRUM.safeL2Singleton, ARBITRUM.safeMultiSendCallOnly, address ?? ""]);
        if (action.kind === "unsupported") throw new ImmersveError(422, "UNSUPPORTED_WITHDRAWAL", action.reason);
        if (action.kind === "simulator") {
          if (!isSandbox) throw new ImmersveError(422, "UNSUPPORTED_WITHDRAWAL", "Sandbox withdrawals are not available here. Nothing was sent.");
          setWithdrawal((w) => ({ ...w, steps: "api" }));
          await c.executeSimulatorWithdrawal(action.url, action.payload);
        } else {
          setWithdrawal((w) => ({ ...w, steps: "chain" }));
          const ok = await exec([{ to: action.to, data: action.data }], "Withdraw card balance", `Your Safe calls withdraw on the card issuer's funds contract and receives ${(cents / 100).toFixed(2)} USDC.`);
          if (!ok) {
            // The card was already debited by the issuer for this intent; it stays pending until executed or it expires.
            setWithdrawal({ busy: false, error: "The withdrawal transaction was not completed. The issuer holds your request for about 30 minutes; try again before it expires.", done: null, steps: null });
            await refresh();
            return false;
          }
        }
        await refresh();
        setWithdrawal({ busy: false, error: null, done: `Moved $${(cents / 100).toFixed(2)} from your card back to your Safe.`, steps: action.kind === "simulator" ? "api" : "chain" });
        return true;
      } catch (e) {
        setWithdrawal({ busy: false, error: friendlyCardError(e), done: null, steps: null });
        await refresh();
        return false;
      }
    },
    [withdrawal.busy, fundingSourceId, balanceBase, isSandbox, exec, address, refresh],
  );

  return {
    stage,
    busy,
    error,
    secrets,
    secondsLeft,
    isSandbox,
    withdrawal,
    withdrawToSafe,
    clearWithdrawal: () => setWithdrawal({ busy: false, error: null, done: null, steps: null }),
    /** What the card can spend right now: the funded balance, in whole cents. */
    cardBalanceCents: baseToCents(balanceBase ?? 0n),
    /** Earned yield that could be added to the card now, in whole cents. */
    fundableCents: cents,
    fundingReady: !!fundingSourceId && balanceBase !== null,
    funding,
    fundingKind,
    probeFunding,
    fund,
    clearFunding: () => setFunding({ busy: false, error: null, done: null, steps: null }),
    cardTransactions,
    markPhoneVerified,
    connectProvider,
    openKyc,
    issueCard,
    refresh,
    reveal,
    hide: () => setSecrets(null),
    dismissError: () => setError(null),
  };
}
