"use client";

import Link from "next/link";
import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { Logo } from "@/components/ui/Icons";
import { erc20Abi } from "@/lib/contracts/abis";
import { verifiedAddress } from "@/lib/contracts/etherfi";
import { CHAIN_OPTIONS, LOCAL_FORK_CHAIN_ID, LOCAL_FORK_ENABLED } from "@/lib/wagmi";

interface DashboardHeaderProps {
  onResetDemo: () => void;
}

/** Shows the connected wallet's real ETH/USDC balances when pointed at the local Anvil fork. */
function ForkWalletBadge() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const active = LOCAL_FORK_ENABLED && isConnected && chainId === LOCAL_FORK_CHAIN_ID;
  // The fork mirrors Arbitrum One, so token addresses come from the Arbitrum registry entry.
  const usdc = verifiedAddress(42161, "USDC");

  const eth = useBalance({ address, chainId: LOCAL_FORK_CHAIN_ID, query: { enabled: active, refetchInterval: 5000 } });
  const usdcBal = useReadContract({
    address: usdc ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: LOCAL_FORK_CHAIN_ID,
    query: { enabled: active && !!usdc && !!address, refetchInterval: 5000 },
  });

  if (!active) return null;
  const ethText = eth.data ? Number(formatUnits(eth.data.value, eth.data.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "…";
  const usdcText = typeof usdcBal.data === "bigint" ? Number(formatUnits(usdcBal.data, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "…";
  return (
    <div data-testid="fork-wallet" className="hidden xl:flex items-center gap-3 rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-1.5 text-[11px] font-mono text-amber">
      <span>FORK</span>
      <span>{ethText} ETH</span>
      <span>{usdcText} USDC</span>
    </div>
  );
}

export function DashboardHeader({ onResetDemo }: DashboardHeaderProps) {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const truncateAddress = (addr?: string) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "");
  const connector = connectors[0];

  return (
    <header className="border-b border-white/5 bg-[#090b10]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 group" aria-label="OrventYield home">
            <Logo className="h-7 w-7 transition-transform group-hover:scale-105" />
            <span className="font-bold text-lg tracking-tight text-fg">
              Orvent<span className="text-cyan">Yield</span>
            </span>
          </Link>
          <span
            data-testid="sandbox-badge"
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber/10 text-amber border border-amber/30"
          >
            SANDBOX
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <ForkWalletBadge />

          <div className="hidden sm:flex items-center bg-surface-2 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-fg">
            <span className="h-2 w-2 rounded-full bg-emerald mr-2" aria-hidden="true" />
            <select
              aria-label="Network"
              data-testid="chain-select"
              value={chainId}
              onChange={(e) => switchChain?.({ chainId: Number(e.target.value) })}
              className="bg-transparent border-none outline-none text-xs font-mono cursor-pointer"
            >
              {CHAIN_OPTIONS.map((c) => (
                <option key={c.id} value={c.id} className="bg-surface text-fg">
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onResetDemo}
            title="Reset sandbox balances and ledger"
            data-testid="reset-sandbox"
            className="hidden lg:inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-muted hover:text-fg hover:border-white/20 transition-colors"
          >
            Reset sandbox
          </button>

          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="bg-surface border border-white/10 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs font-mono">
                <span className="h-2 w-2 rounded-full bg-cyan" aria-hidden="true" />
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
              data-testid="connect-wallet"
              disabled={!connector}
              title={connector ? undefined : "No browser wallet detected"}
              onClick={() => connector && connect({ connector })}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-cyan text-bg hover:brightness-110 transition-all shadow-[0_0_20px_rgba(0,240,255,0.25)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {connector ? "Connect Wallet" : "No wallet detected"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
