"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import Link from "next/link";
import { Logo } from "@/components/ui/Icons";

interface DashboardHeaderProps {
  isSandboxMode: boolean;
  setIsSandboxMode: (val: boolean) => void;
  onResetDemo: () => void;
}

export function DashboardHeader({
  isSandboxMode,
  setIsSandboxMode,
  onResetDemo,
}: DashboardHeaderProps) {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const truncateAddress = (addr?: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <header className="border-b border-white/5 bg-[#090b10]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group">
            <Logo className="h-7 w-7 transition-transform group-hover:scale-105" />
            <span className="font-bold text-lg tracking-tight text-fg">
              Orvent<span className="text-cyan">Yield</span>
            </span>
          </Link>
          <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan/10 text-cyan border border-cyan/20">
            Neobank App
          </span>
          <span className="text-xs text-muted/60 font-mono hidden md:inline">
            Powered by Ether.fi Cash v3
          </span>
        </div>

        {/* Controls & Wallet */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Sandbox / Live Mode Switch */}
          <div className="flex items-center gap-1.5 bg-surface-2 border border-white/5 rounded-full p-1 text-xs">
            <button
              type="button"
              onClick={() => setIsSandboxMode(true)}
              className={`px-3 py-1 rounded-full font-medium transition-all ${
                isSandboxMode
                  ? "bg-cyan text-bg font-semibold shadow-sm shadow-cyan/40"
                  : "text-muted hover:text-fg"
              }`}
            >
              Playground
            </button>
            <button
              type="button"
              onClick={() => setIsSandboxMode(false)}
              className={`px-3 py-1 rounded-full font-medium transition-all ${
                !isSandboxMode
                  ? "bg-emerald text-bg font-semibold shadow-sm shadow-emerald/40"
                  : "text-muted hover:text-fg"
              }`}
            >
              Mainnet
            </button>
          </div>

          {/* Network Selector */}
          <div className="hidden sm:flex items-center bg-surface-2 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-fg">
            <span className="h-2 w-2 rounded-full bg-emerald mr-2 animate-pulse" />
            <select
              value={chainId}
              onChange={(e) => switchChain?.({ chainId: Number(e.target.value) })}
              className="bg-transparent border-none outline-none text-xs font-mono cursor-pointer"
            >
              <option value={42161} className="bg-surface text-fg">Arbitrum One</option>
              <option value={8453} className="bg-surface text-fg">Base</option>
              <option value={534352} className="bg-surface text-fg">Scroll</option>
            </select>
          </div>

          {/* Reset Demo Button */}
          {isSandboxMode && (
            <button
              type="button"
              onClick={onResetDemo}
              title="Reset test balances"
              className="hidden lg:inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-muted hover:text-fg hover:border-white/20 transition-colors"
            >
              Reset Sandbox
            </button>
          )}

          {/* Connect / Disconnect Wallet */}
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="bg-surface border border-white/10 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs font-mono">
                <span className="h-2 w-2 rounded-full bg-cyan" />
                <span className="text-fg">{truncateAddress(address)}</span>
              </div>
              <button
                type="button"
                onClick={() => disconnect()}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger/10 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                const connector = connectors[0];
                if (connector) connect({ connector });
              }}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-cyan text-bg hover:brightness-110 transition-all shadow-[0_0_20px_rgba(0,240,255,0.25)]"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
