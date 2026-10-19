"use client";

import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useAppMode } from "@/features/mode/AppModeProvider";
import { erc20Abi } from "@/lib/contracts/abis";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/5 bg-surface p-5 ${className}`}>{children}</div>;
}

function ConnectGate() {
  const { openWalletModal, setMode } = useAppMode();
  return (
    <Card className="mx-auto max-w-xl text-center">
      <div data-testid="mainnet-gate" className="space-y-4 py-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan/30 bg-cyan/10 text-2xl" aria-hidden="true">🔐</div>
        <h2 className="text-xl font-bold text-fg">Connect your wallet</h2>
        <p className="mx-auto max-w-sm text-sm text-muted">
          Your own Safe account is created when you make your first deposit. Your principal stays in your Safe and earns yield on Aave; you spend only the yield.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            data-testid="gate-connect"
            onClick={() => openWalletModal({ thenMainnet: true })}
            className="min-h-12 rounded-xl bg-cyan px-8 text-sm font-semibold text-bg shadow-[0_0_30px_rgba(0,240,255,0.3)] hover:brightness-110"
          >
            Connect wallet
          </button>
          <button type="button" onClick={() => setMode("playground")} className="min-h-12 rounded-xl border border-white/10 px-6 text-sm font-semibold text-fg hover:bg-white/5">
            Try the playground
          </button>
        </div>
      </div>
    </Card>
  );
}

function ConnectedWallet({ owner }: { owner: `0x${string}` }) {
  const usdc = useReadContract({
    address: ARBITRUM.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    chainId: ARBITRUM_CHAIN_ID,
  });
  const balance = typeof usdc.data === "bigint" ? Number(formatUnits(usdc.data, 6)) : null;
  return (
    <Card className="mx-auto max-w-xl">
      <div data-testid="mainnet-connected" className="space-y-4 py-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Connected · {short(owner)}</p>
        <p data-testid="wallet-usdc" className="text-3xl font-extrabold tabular text-fg">
          {usdc.isError ? "Balance unavailable" : balance === null ? "…" : `${balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`}
        </p>
        <p className="text-sm text-muted">USDC in your wallet on Arbitrum One.</p>
        <div data-testid="mainnet-soon" className="rounded-xl border border-cyan/20 bg-cyan/5 p-4 text-sm text-muted">
          Deposits into your own Safe and Aave position are being finished. Until then, try the full experience in the playground.
        </div>
      </div>
    </Card>
  );
}

export function MainnetDashboard() {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) return <ConnectGate />;
  return <ConnectedWallet owner={address} />;
}
