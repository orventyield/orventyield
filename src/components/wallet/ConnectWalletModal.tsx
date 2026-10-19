"use client";

import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, type Connector } from "wagmi";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { KNOWN_WALLETS, findKnownWallet, isMobileUserAgent, type KnownWallet } from "./walletList";

type View = "list" | "wc";

const WC_TIMEOUT_MS = 12_000;

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel|closed/i.test(msg)) return "Connection request was cancelled.";
  if (/already pending/i.test(msg)) return "A request is already open in your wallet. Check the wallet app.";
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

function WalletAvatar({ name, icon, color }: { name: string; icon?: string; color?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (icon) return <img src={icon} alt="" className="h-9 w-9 rounded-xl bg-white/5 object-contain p-1" />;
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold text-white"
      style={{ background: color ?? "#2a2f3a" }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

function Row({
  testId,
  name,
  icon,
  color,
  badge,
  hint,
  busy,
  onClick,
}: {
  testId: string;
  name: string;
  icon?: string;
  color?: string;
  badge?: string;
  hint?: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={busy}
      className="group flex min-h-14 w-full items-center gap-3 rounded-2xl border border-white/5 bg-surface-2 px-3.5 py-2.5 text-left transition hover:border-cyan/40 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-cyan disabled:cursor-wait disabled:opacity-70"
    >
      <WalletAvatar name={name} icon={icon} color={color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{name}</span>
        {hint && <span className="block truncate text-[11px] text-muted">{hint}</span>}
      </span>
      {busy ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan border-t-transparent" aria-label="Connecting" />
      ) : (
        badge && <span className="rounded-full border border-emerald/30 bg-emerald/10 px-2 py-0.5 font-mono text-[10px] text-emerald">{badge}</span>
      )}
    </button>
  );
}

export function ConnectWalletModal() {
  const { walletModalOpen, closeWalletModal, setMode, switchToMainnetOnConnect } = useAppMode();
  const { isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();

  const [view, setView] = useState<View>("list");
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcFailed, setWcFailed] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const wcProvider = useRef<{ removeListener?: (e: string, f: (u: string) => void) => void } | null>(null);
  const uriHandler = useRef<((u: string) => void) | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detected = useMemo(() => connectors.filter((c) => c.type === "injected" && c.id !== "injected"), [connectors]);
  const legacyInjected = useMemo(() => {
    const generic = connectors.find((c) => c.id === "injected");
    const hasProvider = typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
    return generic && hasProvider && detected.length === 0 ? generic : undefined;
  }, [connectors, detected]);
  const coinbase = useMemo(() => connectors.find((c) => c.type === "coinbaseWallet" || c.id === "coinbaseWalletSDK"), [connectors]);
  const wc = useMemo(() => connectors.find((c) => c.type === "walletConnect"), [connectors]);
  const detectedKnown = useMemo(() => new Set(detected.map((c) => findKnownWallet(c.id)?.id).filter(Boolean)), [detected]);

  const cleanupWc = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    if (wcProvider.current && uriHandler.current) wcProvider.current.removeListener?.("display_uri", uriHandler.current);
    wcProvider.current = null;
    uriHandler.current = null;
  }, []);

  const reset = useCallback(() => {
    cleanupWc();
    setView("list");
    setPendingUid(null);
    setError(null);
    setWcUri(null);
    setWcFailed(false);
    setQr(null);
    setCopied(false);
  }, [cleanupWc]);

  const close = useCallback(() => {
    reset();
    closeWalletModal();
  }, [reset, closeWalletModal]);

  // Open: remember focus, detect mobile, optional dev-only QR preview; close: restore focus.
  useEffect(() => {
    if (!walletModalOpen) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    setIsMobile(isMobileUserAgent(navigator.userAgent));
    if (process.env.NODE_ENV !== "production") {
      const preview = new URLSearchParams(window.location.search).get("wcqr");
      if (preview) {
        setView("wc");
        setWcUri(preview);
      }
    }
    const raf = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      cancelAnimationFrame(raf);
      lastFocus.current?.focus?.();
    };
  }, [walletModalOpen]);

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    if (!walletModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key !== "Tab" || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input");
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      // Focus can still be on the trigger for a moment after opening: pull it into the dialog.
      if (!panelRef.current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [walletModalOpen, close]);

  // Render the pairing URI as a QR code.
  useEffect(() => {
    if (!wcUri) return setQr(null);
    let alive = true;
    QRCode.toDataURL(wcUri, { margin: 1, width: 440, errorCorrectionLevel: "M", color: { dark: "#07080C", light: "#FFFFFF" } })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [wcUri]);

  // Cleanup on unmount.
  useEffect(() => cleanupWc, [cleanupWc]);

  // A successful connection closes the modal (and flips to Mainnet when that is why it was opened).
  useEffect(() => {
    if (walletModalOpen && isConnected) {
      if (switchToMainnetOnConnect) setMode("mainnet");
      close();
    }
  }, [isConnected, walletModalOpen, switchToMainnetOnConnect, setMode, close]);

  const connectWith = useCallback(
    async (connector: Connector) => {
      setError(null);
      setWcFailed(false);
      setPendingUid(connector.uid);
      try {
        if (connector.type === "walletConnect") {
          setView("wc");
          setWcUri(null);
          const provider = (await connector.getProvider()) as {
            on: (e: string, f: (u: string) => void) => void;
            removeListener?: (e: string, f: (u: string) => void) => void;
          };
          cleanupWc();
          wcProvider.current = provider;
          uriHandler.current = (uri: string) => {
            if (timeout.current) clearTimeout(timeout.current);
            setWcUri(uri);
          };
          provider.on("display_uri", uriHandler.current);
          timeout.current = setTimeout(() => setWcFailed(true), WC_TIMEOUT_MS);
        }
        await connectAsync({ connector });
      } catch (e) {
        setError(shortError(e));
        if (connector.type === "walletConnect") setWcFailed(true);
      } finally {
        setPendingUid(null);
      }
    },
    [connectAsync, cleanupWc],
  );

  const startWalletConnect = useCallback(() => {
    if (wc) void connectWith(wc);
  }, [wc, connectWith]);

  const copyUri = async () => {
    if (!wcUri) return;
    try {
      await navigator.clipboard.writeText(wcUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const guest = () => {
    setMode("playground");
    close();
  };

  const undetected = KNOWN_WALLETS.filter((w) => !detectedKnown.has(w.id) && w.id !== "coinbase");

  const onUndetected = (w: KnownWallet) => {
    if (wc) startWalletConnect();
    else window.open(w.install, "_blank", "noopener,noreferrer");
  };

  return (
    <AnimatePresence>
      {walletModalOpen && (
        <motion.div
          key="overlay"
          data-testid="wallet-modal"
          role="presentation"
          className="fixed inset-0 z-[80] grid items-end bg-black/70 backdrop-blur-sm sm:place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-surface p-5 shadow-[0_-20px_80px_-20px_rgba(0,240,255,0.25)] sm:max-w-md sm:rounded-3xl sm:p-6"
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {view === "wc" && (
                  <button
                    type="button"
                    aria-label="Back to wallet list"
                    data-testid="wallet-back"
                    onClick={reset}
                    className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-muted hover:text-fg"
                  >
                    ←
                  </button>
                )}
                <h2 id="wallet-modal-title" className="text-lg font-bold text-fg">
                  {view === "wc" ? "Scan with your wallet" : "Connect a wallet"}
                </h2>
              </div>
              <button
                type="button"
                data-testid="wallet-close"
                aria-label="Close"
                onClick={close}
                className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-muted hover:text-fg"
              >
                ✕
              </button>
            </div>

            {error && (
              <div role="alert" data-testid="wallet-error" className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}

            {view === "list" ? (
              <div className="space-y-4">
                {detected.length > 0 || legacyInjected ? (
                  <section aria-label="Detected wallets" className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Detected on this device</p>
                    {detected.map((c) => (
                      <Row
                        key={c.uid}
                        testId={`wallet-option-${c.id}`}
                        name={c.name}
                        icon={c.icon}
                        color={findKnownWallet(c.id)?.color}
                        badge="Detected"
                        hint="Browser wallet"
                        busy={pendingUid === c.uid}
                        onClick={() => void connectWith(c)}
                      />
                    ))}
                    {legacyInjected && (
                      <Row
                        testId="wallet-option-injected"
                        name="Browser wallet"
                        badge="Detected"
                        hint="Injected provider"
                        busy={pendingUid === legacyInjected.uid}
                        onClick={() => void connectWith(legacyInjected)}
                      />
                    )}
                  </section>
                ) : null}

                <section aria-label="Connect options" className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                    {detected.length > 0 ? "More options" : "Choose how to connect"}
                  </p>
                  {wc && (
                    <Row
                      testId="wallet-option-walletconnect"
                      name="WalletConnect"
                      color="#3B99FC"
                      hint={isMobile ? "Open your wallet app" : "Scan a QR code with your phone"}
                      badge="QR"
                      busy={pendingUid === wc.uid}
                      onClick={startWalletConnect}
                    />
                  )}
                  {coinbase && (
                    <Row
                      testId="wallet-option-coinbase"
                      name="Coinbase Wallet"
                      color="#0052FF"
                      hint="Browser extension or mobile app"
                      busy={pendingUid === coinbase.uid}
                      onClick={() => void connectWith(coinbase)}
                    />
                  )}
                  {undetected.map((w) => (
                    <Row
                      key={w.id}
                      testId={`wallet-option-${w.id}`}
                      name={w.name}
                      color={w.color}
                      hint={wc ? (isMobile ? "Open in app" : "Connect with QR code") : "Get the wallet"}
                      onClick={() => onUndetected(w)}
                    />
                  ))}
                </section>
              </div>
            ) : (
              <div data-testid="wc-pane" className="space-y-4">
                {wcFailed && !wcUri ? (
                  <div className="rounded-2xl border border-white/10 bg-surface-2 p-4 text-center text-sm text-muted">
                    <p className="font-semibold text-fg">Couldn&rsquo;t reach the WalletConnect network</p>
                    <p className="mt-1 text-xs">Check your connection and try again, or pick another wallet.</p>
                    <button type="button" onClick={startWalletConnect} className="mt-3 rounded-xl bg-cyan px-4 py-2 text-xs font-semibold text-bg">
                      Try again
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto grid aspect-square w-full max-w-[260px] place-items-center rounded-2xl bg-white p-3">
                      {qr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img data-testid="wc-qr" src={qr} alt="WalletConnect QR code. Scan it with your wallet app." className="h-full w-full" />
                      ) : (
                        <span className="h-8 w-8 animate-spin rounded-full border-4 border-[#07080C]/20 border-t-[#07080C]" aria-label="Preparing QR code" />
                      )}
                    </div>
                    <p className="text-center text-xs text-muted">
                      {isMobile ? "Tap your wallet to approve the connection." : "Open your wallet app, tap Scan, and point it at this code."}
                    </p>

                    {wcUri && (
                      <div className="space-y-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Open directly</p>
                        <div className="grid grid-cols-2 gap-2">
                          {KNOWN_WALLETS.filter((w) => w.deepLink).map((w) => (
                            <a
                              key={w.id}
                              data-testid={`deeplink-${w.id}`}
                              href={w.deepLink!(wcUri)}
                              className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-surface-2 px-3 text-xs font-semibold text-fg hover:border-cyan/40"
                            >
                              <WalletAvatar name={w.name} color={w.color} />
                              <span className="truncate">{w.name}</span>
                            </a>
                          ))}
                        </div>
                        <button
                          type="button"
                          data-testid="wc-copy"
                          onClick={copyUri}
                          className="w-full rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-cyan hover:bg-white/5"
                        >
                          {copied ? "Copied" : "Copy connection link"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-5 border-t border-white/5 pt-4">
              <button
                type="button"
                data-testid="guest-button"
                onClick={guest}
                className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-cyan/30 bg-cyan/10 px-4 text-left transition hover:bg-cyan/15"
              >
                <span>
                  <span className="block text-sm font-semibold text-cyan">Continue as guest</span>
                  <span className="block text-[11px] text-muted">Explore the full playground. No wallet needed.</span>
                </span>
                <span aria-hidden="true" className="text-cyan">→</span>
              </button>
              <p className="mt-3 text-center text-[10px] leading-relaxed text-muted/70">
                OrventYield never holds your keys or funds. Connecting only lets the app read your account.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
