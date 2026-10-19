"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useIdentity } from "@/features/identity/IdentityProvider";
import { ImmersveClient, ImmersveError, immersveConfig, readiness, type Card, type CardReadiness, type CardSecrets } from "@/lib/immersve";
import { allowanceCents, deriveStage, type CardStage } from "@/lib/immersve/stage";

const REVEAL_SECONDS = 30;
const POLL_MS = 6000;
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
 * single-use PAN/CVV reveal. `yieldBaseUnits` is the user's live available yield (USDC, 6 decimals); the card's spend
 * allowance is exactly that, rounded down to cents.
 */
export function useCardSuite(yieldBaseUnits: bigint) {
  const { address, isConnected } = useAccount();
  const { client: identity, owner: identityOwner, isWallet, sign } = useIdentity();
  const imsv = useRef<ImmersveClient | null>(null);
  if (imsv.current === null) imsv.current = new ImmersveClient(immersveConfig());

  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [ready, setReady] = useState<CardReadiness | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [fundingSourceId, setFundingSourceId] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<CardSecrets | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState<"login" | "kyc" | "issue" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cents = allowanceCents(yieldBaseUnits);
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
    setSecrets(null);
    setError(null);
  }, [address]);

  const refresh = useCallback(async () => {
    const c = imsv.current!;
    if (!c.isLoggedIn || !address) return;
    try {
      const fs = fundingSourceId ? { id: fundingSourceId } : await c.ensureFundingSource(address);
      setFundingSourceId(fs.id);
      const [prereqs, list] = await Promise.all([
        c.spendingPrerequisites(fs.id, Math.max(cents, MIN_DECLARED_CENTS), kycReturnUrl()),
        c.listCards(),
      ]);
      setReady(readiness(prereqs));
      setCards(list);
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

  return {
    stage,
    busy,
    error,
    secrets,
    secondsLeft,
    allowanceCents: cents,
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
