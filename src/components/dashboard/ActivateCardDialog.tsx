"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useIdentity } from "@/features/identity/IdentityProvider";
import { ClientError, DEMO_CODE } from "@/lib/identity/client";
import { guessCountry, listCountries, maskPhone, normalizePhone, type CountryCode } from "@/lib/identity/phone";
import type { StartResult } from "@/lib/identity/service";

type Step = "phone" | "otp" | "success";
type Session = Extract<StartResult, { alreadyActive: false }> & { e164: string };

export interface Activation {
  maskedPhone: string;
  /** Pseudonymous identity id from the verification service; absent when the card was already active. */
  identityId?: string;
}

const OTP_LENGTH = 6;
const BLOCKING = new Set(["PHONE_ALREADY_BOUND", "OWNER_ALREADY_HAS_CARD"]);

function Steps({ step }: { step: Step }) {
  const items = [
    { id: "phone", label: "Mobile number" },
    { id: "otp", label: "Verify code" },
  ];
  const idx = step === "phone" ? 0 : 1;
  return (
    <ol className="mb-5 flex items-center gap-2 text-[11px] font-mono" aria-label="Progress">
      {items.map((it, i) => (
        <li key={it.id} className="flex items-center gap-2" aria-current={i === idx ? "step" : undefined}>
          <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${i <= idx ? "border-cyan bg-cyan/15 text-cyan" : "border-white/10 text-muted"}`}>{i + 1}</span>
          <span className={i <= idx ? "text-fg" : "text-muted"}>{it.label}</span>
          {i === 0 && <span className="mx-1 h-px w-6 bg-white/10" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export function ActivateCardDialog({
  open,
  onClose,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  onActivated: (a: Activation) => void;
}) {
  const { client, owner, isWallet, sign } = useIdentity();
  const countries = useMemo(() => listCountries(), []);

  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState<CountryCode>(() => (typeof navigator === "undefined" ? "US" : guessCountry(navigator.language)));
  const [national, setNational] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; blocking: boolean } | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [shake, setShake] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("phone");
    setNational("");
    setSession(null);
    setCode("");
    setBusy(false);
    setError(null);
    setAttemptsLeft(null);
    setResendIn(0);
    setCooldown(0);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // One-second ticker for both the resend countdown and a rate-limit cooldown.
  useEffect(() => {
    if (resendIn <= 0 && cooldown <= 0) return;
    const id = setInterval(() => {
      setResendIn((s) => Math.max(0, s - 1));
      setCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendIn, cooldown]);

  const preview = useMemo(() => {
    const r = national.trim() ? normalizePhone({ country, national }) : null;
    return r && r.ok ? r : null;
  }, [country, national]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ClientError) {
      setError({ message: e.message + (e.retryAfterSec && e.retryAfterSec > 1 ? ` Try again in ${formatWait(e.retryAfterSec)}.` : ""), blocking: BLOCKING.has(e.code) });
      if (e.retryAfterSec) setCooldown(e.retryAfterSec);
      if (e.attemptsLeft !== undefined) setAttemptsLeft(e.attemptsLeft);
      return e;
    }
    setError({ message: "Something went wrong. Please try again.", blocking: false });
    return null;
  }, []);

  const finish = useCallback(
    (a: Activation) => {
      setStep("success");
      onActivated(a);
      setTimeout(onClose, 1100);
    },
    [onActivated, onClose],
  );

  const sendCode = async (e164: string) => {
    if (!client || !owner) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.start(e164, owner);
      if (r.alreadyActive) return finish({ maskedPhone: maskPhone(e164) });
      setSession({ ...r, e164 });
      setStep("otp");
      setCode("");
      setAttemptsLeft(null);
      setResendIn(r.resendAfterSec);
      requestAnimationFrame(() => otpRef.current?.focus());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = (ev: React.FormEvent) => {
    ev.preventDefault();
    const r = normalizePhone({ country, national });
    if (!r.ok) return setError({ message: r.message, blocking: false });
    void sendCode(r.e164);
  };

  const verify = async (value: string) => {
    if (!client || !owner || !session || busy) return;
    setBusy(true);
    setError(null);
    try {
      let signature: string | undefined;
      if (session.messageToSign && isWallet) {
        try {
          signature = await sign(session.messageToSign);
        } catch {
          setError({ message: "Wallet signature was declined. Signing is free and proves the wallet is yours.", blocking: false });
          setCode("");
          return;
        }
      }
      const r = await client.check({ phone: session.e164, code: value, owner, nonce: session.nonce, signature });
      finish({ maskedPhone: r.maskedPhone, identityId: r.identityId });
    } catch (err) {
      const ce = fail(err);
      setCode("");
      if (ce?.code === "INVALID_CODE") setShake((n) => n + 1);
      requestAnimationFrame(() => otpRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === OTP_LENGTH) void verify(digits);
  };

  const needsNewCode = !!error && !error.blocking && !!session && /expired|too many incorrect|wasn't found/i.test(error.message);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="activate-title" testId="otp-dialog" dismissible={step !== "success"}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 id="activate-title" className="text-lg font-bold text-fg">
            {step === "success" ? "Card activated" : "Activate your card"}
          </h2>
          {step !== "success" && <p className="mt-0.5 text-xs text-muted">One verified person, one card. Takes about 30 seconds.</p>}
        </div>
        {step !== "success" && (
          <button type="button" aria-label="Close" data-testid="otp-close" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-muted hover:text-fg">
            ✕
          </button>
        )}
      </div>

      {step !== "success" && <div className="mt-4"><Steps step={step} /></div>}

      <div aria-live="polite" className="min-h-0">
        {error && (
          <div
            role="alert"
            data-testid={error.blocking ? "dup-error" : step === "otp" ? "otp-error" : "phone-error"}
            className={`mb-4 rounded-xl border px-3 py-2.5 text-xs ${error.blocking ? "border-danger/40 bg-danger/10 text-danger" : "border-amber/30 bg-amber/10 text-amber"}`}
          >
            {error.message}
            {attemptsLeft !== null && attemptsLeft > 0 && step === "otp" && <span className="block text-[11px] opacity-80">{attemptsLeft} {attemptsLeft === 1 ? "attempt" : "attempts"} left.</span>}
          </div>
        )}
      </div>

      {step === "phone" && (
        <form onSubmit={submitPhone} className="space-y-4" noValidate data-testid="phone-step">
          <div>
            <label htmlFor="phone-national" className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted">Mobile number</label>
            <div className="flex gap-2">
              <select
                aria-label="Country calling code"
                data-testid="phone-country"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value as CountryCode);
                  setError(null);
                }}
                className="h-12 w-[8.5rem] shrink-0 rounded-xl border border-white/10 bg-surface-2 px-2 text-sm text-fg outline-none focus:border-cyan"
              >
                {countries.map((c) => (
                  <option key={c.iso} value={c.iso} className="bg-surface">
                    {c.flag} {c.name} ({c.dial})
                  </option>
                ))}
              </select>
              <input
                id="phone-national"
                data-testid="phone-input"
                data-autofocus
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="Phone number"
                value={national}
                onChange={(e) => {
                  setNational(e.target.value);
                  setError(null);
                }}
                className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-3.5 font-mono text-base text-fg outline-none focus:border-cyan"
              />
            </div>
            <p data-testid="phone-preview" className="mt-2 min-h-4 text-[11px] text-muted">
              {preview ? <>We&rsquo;ll text a code to <span className="font-mono text-cyan">{preview.e164}</span></> : "Standard SMS rates may apply."}
            </p>
          </div>
          <button
            type="submit"
            data-testid="phone-submit"
            disabled={busy || cooldown > 0 || !client || !owner}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.25)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-bg border-t-transparent" aria-label="Sending" /> : cooldown > 0 ? `Try again in ${formatWait(cooldown)}` : "Send code"}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-muted/70">
            We never store your number. Only a one-way fingerprint is kept, to stop duplicate cards.
          </p>
        </form>
      )}

      {step === "otp" && session && (
        <div className="space-y-4" data-testid="otp-step">
          <p className="text-sm text-muted">
            Enter the 6-digit code sent to <span className="font-mono text-fg" data-testid="otp-sent-to">{session.maskedPhone}</span>.
          </p>

          <motion.div key={shake} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : undefined} transition={{ duration: 0.35 }} className="relative">
            <label htmlFor="otp-input" className="sr-only">6-digit verification code</label>
            <input
              ref={otpRef}
              id="otp-input"
              data-testid="otp-input"
              data-autofocus
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={OTP_LENGTH}
              value={code}
              disabled={busy}
              onChange={(e) => onCodeChange(e.target.value)}
              aria-describedby="otp-help"
              className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
            />
            <div className="grid grid-cols-6 gap-2" aria-hidden="true">
              {Array.from({ length: OTP_LENGTH }).map((_, i) => {
                const active = i === Math.min(code.length, OTP_LENGTH - 1) && !busy;
                return (
                  <div
                    key={i}
                    data-testid={`otp-cell-${i}`}
                    className={`grid h-14 place-items-center rounded-xl border bg-surface-2 font-mono text-2xl font-bold text-fg transition ${
                      error && !error.blocking ? "border-amber/50" : active ? "border-cyan shadow-[0_0_0_3px_rgba(0,240,255,0.15)]" : "border-white/10"
                    }`}
                  >
                    {code[i] ?? ""}
                  </div>
                );
              })}
            </div>
          </motion.div>

          <p id="otp-help" className="text-[11px] text-muted">
            {busy ? "Verifying…" : "The code is verified automatically when you finish typing."}
            {client?.mode === "demo" && (
              <span data-testid="otp-hint" className="ml-1 text-cyan">
                Playground: use code {DEMO_CODE}.
              </span>
            )}
          </p>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              data-testid="otp-change"
              onClick={() => {
                setStep("phone");
                setError(null);
                setCode("");
              }}
              className="text-muted hover:text-fg"
            >
              Change number
            </button>
            <button
              type="button"
              data-testid="otp-resend"
              disabled={busy || resendIn > 0 || cooldown > 0}
              onClick={() => void sendCode(session.e164)}
              className={`font-semibold ${needsNewCode ? "text-cyan" : "text-cyan/80"} hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline`}
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : cooldown > 0 ? `Try again in ${formatWait(cooldown)}` : "Resend code"}
            </button>
          </div>
        </div>
      )}

      {step === "success" && (
        <motion.div data-testid="activation-success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 14 }}
            className="grid h-16 w-16 place-items-center rounded-full border border-emerald/40 bg-emerald/15 text-3xl text-emerald shadow-[0_0_40px_rgba(16,185,129,0.4)]"
          >
            ✓
          </motion.div>
          <p className="text-base font-semibold text-fg">You&rsquo;re verified</p>
          <p className="text-xs text-muted">Unlocking your card…</p>
        </motion.div>
      )}
    </Dialog>
  );
}

function formatWait(sec: number): string {
  if (sec >= 3600) return `${Math.ceil(sec / 3600)}h`;
  if (sec >= 120) return `${Math.ceil(sec / 60)} min`;
  return `${sec}s`;
}
