"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useChainId, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { Logo } from "@/components/ui/Icons";
import { useAppMode, type AppMode, type AppNetwork } from "@/features/mode/AppModeProvider";
import { erc20Abi } from "@/lib/contracts/abis";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";
import { ROBINHOOD_CHAIN_ID } from "@/lib/contracts/robinhood";
import { LOCAL_FORK_CHAIN_ID, LOCAL_FORK_ENABLED } from "@/lib/wagmi";

/** Real ETH/USDC balances of the connected wallet when pointed at the local Anvil fork. */
function ForkWalletBadge() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const active = LOCAL_FORK_ENABLED && isConnected && chainId === LOCAL_FORK_CHAIN_ID;
  // The fork mirrors Arbitrum One, so token addresses are the Arbitrum ones.
  const usdc = ARBITRUM.usdc;

  const eth = useBalance({ address, chainId: LOCAL_FORK_CHAIN_ID, query: { enabled: active, refetchInterval: 5000 } });
  const usdcBal = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: LOCAL_FORK_CHAIN_ID,
    query: { enabled: active && !!address, refetchInterval: 5000 },
  });

  if (!active) return null;
  const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const ethText = eth.data ? fmt(eth.data.value, eth.data.decimals) : "…";
  const usdcText = typeof usdcBal.data === "bigint" ? fmt(usdcBal.data, 6) : "…";
  return (
    <div data-testid="fork-wallet" className="hidden items-center gap-3 rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-1.5 font-mono text-[11px] text-amber xl:flex">
      <span>FORK</span>
      <span>{ethText} ETH</span>
      <span>{usdcText} USDC</span>
    </div>
  );
}

const MODES: { id: AppMode; label: string; dot: string; active: string }[] = [
  { id: "playground", label: "Playground", dot: "bg-cyan", active: "text-bg" },
  { id: "mainnet", label: "Mainnet", dot: "bg-emerald", active: "text-bg" },
];

/** Segmented Playground / Mainnet switch with a sliding highlight. */
function ModeToggle() {
  const { mode, setMode } = useAppMode();
  return (
    <div
      role="radiogroup"
      aria-label="Account mode"
      data-testid="mode-toggle"
      className="relative flex rounded-full border border-white/10 bg-surface-2 p-1 text-xs font-semibold"
    >
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`mode-${m.id}`}
            onClick={() => setMode(m.id)}
            className={`relative z-10 flex min-h-9 items-center gap-2 rounded-full px-4 transition-colors sm:px-5 ${active ? m.active : "text-muted hover:text-fg"}`}
          >
            {active && (
              <motion.span
                layoutId="mode-pill"
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
                className={`absolute inset-0 -z-10 rounded-full ${m.id === "mainnet" ? "bg-emerald shadow-[0_0_24px_rgba(16,185,129,0.45)]" : "bg-cyan shadow-[0_0_24px_rgba(0,240,255,0.4)]"}`}
              />
            )}
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? "bg-bg/70" : m.dot}`} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function ArbitrumIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.5L3.5 16.5L5.8 20.5L12 10.2L18.2 20.5L20.5 16.5L12 2.5Z"
        fill="#28A0F0"
      />
      <path
        d="M12 12.8L9 18H15L12 12.8Z"
        fill="#00F0FF"
      />
    </svg>
  );
}

function RobinhoodIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M13 2.5C13 2.5 13.5 8 9.8 12.2C6 16.5 5 21.5 5 21.5C5 21.5 9.2 20.5 13 16C16.8 11.5 19 6.5 19 2.5H13Z"
        fill="#00C805"
      />
      <path
        d="M13 16C11.5 17.5 10 19 9 20C10 19.5 11.5 18.5 13 16Z"
        fill="#10B981"
      />
    </svg>
  );
}

const NETWORKS = [
  {
    id: "arbitrum" as const,
    name: "Arbitrum One",
    shortName: "Arbitrum",
    token: "USDC",
    chainId: ARBITRUM_CHAIN_ID,
    icon: ArbitrumIcon,
    activeColor: "text-cyan",
    activeGlow: "shadow-[0_0_24px_rgba(0,240,255,0.35)]",
    activeBg: "bg-gradient-to-r from-cyan/20 to-blue-500/15 border-cyan/40",
  },
  {
    id: "robinhood" as const,
    name: "Robinhood Chain",
    shortName: "Robinhood",
    token: "USDG",
    chainId: ROBINHOOD_CHAIN_ID,
    icon: RobinhoodIcon,
    activeColor: "text-emerald",
    activeGlow: "shadow-[0_0_24px_rgba(16,185,129,0.35)]",
    activeBg: "bg-gradient-to-r from-emerald/20 to-green-500/15 border-emerald/40",
  },
] as const;

/**
 * Interactive segmented network switcher: both Arbitrum One and Robinhood Chain are always visible side-by-side.
 * Clicking either network immediately switches the app view AND prompts the wallet to switch chain if connected.
 */
function NetworkSwitcher() {
  const { network, setNetwork } = useAppMode();
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const handleSwitch = (target: AppNetwork) => {
    setNetwork(target);
    const targetChainId = target === "arbitrum" ? ARBITRUM_CHAIN_ID : ROBINHOOD_CHAIN_ID;
    if (isConnected && switchChain && walletChainId !== targetChainId) {
      if (!(LOCAL_FORK_ENABLED && walletChainId === LOCAL_FORK_CHAIN_ID)) {
        try {
          switchChain({ chainId: targetChainId });
        } catch {
          /* wallet rejected or unsupported; UI state switched safely */
        }
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Yield Network"
      data-testid="network-switcher"
      className="relative flex items-center rounded-full border border-white/10 bg-surface-2 p-1 text-xs font-semibold shadow-inner"
    >
      {NETWORKS.map((n) => {
        const active = network === n.id;
        const Icon = n.icon;
        return (
          <button
            key={n.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`network-option-${n.id}`}
            onClick={() => handleSwitch(n.id)}
            className={`group relative z-10 flex min-h-10 sm:min-h-11 items-center gap-1.5 rounded-full px-3 sm:px-4 text-xs transition-all select-none sm:gap-2 ${
              active ? "text-fg font-bold" : "text-muted hover:text-fg hover:bg-white/[0.04]"
            }`}
          >
            {active && (
              <motion.span
                layoutId="network-active-pill"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                className={`absolute inset-0 -z-10 rounded-full border ${n.activeBg} ${n.activeGlow}`}
              />
            )}
            <Icon className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${active ? n.activeColor : "opacity-70 group-hover:opacity-100"}`} />
            <span className="hidden sm:inline">{n.name}</span>
            <span className="inline sm:hidden">{n.shortName}</span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                active ? `${n.activeColor} bg-white/10` : "text-muted/80 bg-white/5"
              }`}
            >
              {n.token}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { openWalletModal, mode } = useAppMode();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        data-testid="connect-wallet"
        onClick={() => openWalletModal({ thenMainnet: true })}
        className="min-h-10 rounded-xl bg-cyan px-4 text-xs font-semibold text-bg shadow-[0_0_20px_rgba(0,240,255,0.25)] transition hover:brightness-110"
      >
        {mode === "playground" ? "Go to Real Mainnet →" : "Connect Wallet"}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-surface px-3 font-mono text-xs text-fg hover:border-cyan/40"
      >
        <span className="h-2 w-2 rounded-full bg-emerald" aria-hidden="true" />
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-2xl">
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable */
              }
            }}
            className="block w-full px-4 py-3 text-left text-xs text-fg hover:bg-white/5"
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="disconnect"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="block w-full border-t border-white/5 px-4 py-3 text-left text-xs text-danger hover:bg-danger/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardHeader({ onResetDemo }: { onResetDemo?: () => void }) {
  const { mode } = useAppMode();
  const { isConnected } = useAccount();
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#07080C]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2" aria-label="OrventYield home">
          <Logo className="h-9 w-9 transition-transform group-hover:scale-105" />
          <span className="text-lg font-bold tracking-tight text-fg">
            Orvent<span className="text-cyan">Yield</span>
          </span>
        </Link>

        {/* Disconnected: the choice (connect or try the playground) lives on the page itself, not in three places. */}
        {isConnected && (
          <div className="order-3 flex w-full justify-center md:order-none md:w-auto">
            <ModeToggle />
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          <ForkWalletBadge />
          {mode === "mainnet" && <NetworkSwitcher />}
          {mode === "playground" && !isConnected && (
            <span data-testid="demo-badge" className="hidden items-center gap-1.5 rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-1.5 text-xs font-semibold text-amber md:flex">
              <span aria-hidden="true">🧪</span> Demo Mode
            </span>
          )}
          {mode === "playground" && onResetDemo && (
            <button
              type="button"
              data-testid="reset-sandbox"
              onClick={onResetDemo}
              title="Reset playground balances and ledger"
              className="hidden items-center rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-white/20 hover:text-fg lg:inline-flex"
            >
              Reset
            </button>
          )}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
