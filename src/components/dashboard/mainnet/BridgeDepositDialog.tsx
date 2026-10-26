"use client";

import { useId } from "react";
import type { Address } from "viem";
import { useAccount, useChainId, useConfig } from "wagmi";
import { BridgeDepositWidget } from "@/components/dashboard/mainnet/BridgeDepositWidget";
import { TxSteps } from "@/components/dashboard/mainnet/TxSteps";
import { Dialog } from "@/components/ui/Dialog";
import type { TxStep } from "@/features/account/useSafeAccount";
import { fmtUsdc } from "@/lib/aave/format";
import { switchOrAddChain } from "@/lib/chainSwitch";
import { ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";
import { LOCAL_FORK_CHAIN_ID, LOCAL_FORK_ENABLED } from "@/lib/wagmi";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The user's Safe: the bridge destination is locked to it. */
  safe: Address;
  /** USDC or USDG already sitting in the Safe (bridged in, not yet earning). */
  idleUsdc?: bigint;
  idleAmount?: bigint;
  /** Token symbol (e.g. "USDC" or "USDG"). Defaults to "USDC". */
  asset?: string;
  /** Network name (e.g. "Arbitrum One" or "Robinhood Chain"). Defaults to "Arbitrum One". */
  networkName?: string;
  /** Vault protocol name (e.g. "Aave" or "Morpho"). Defaults to "Aave". */
  vaultName?: string;
  /** Destination chain ID for LI.FI. Defaults to Arbitrum One (42161). */
  toChainId?: number;
  /** Destination token address for LI.FI. Defaults to Arbitrum USDC or Robinhood USDG. */
  toTokenAddress?: Address;
  steps: TxStep[];
  busy: boolean;
  error: string | null;
  success: string | null;
  explorer?: string;
  onSupply: (amount: bigint) => void;
  onConnect: () => void;
}

/** Bridge from any chain or token into the user's Safe, then one click to put it to work in the vault. */
export function BridgeDepositDialog(p: Props) {
  const id = useId();
  const started = p.steps.length > 0;
  const idle = p.idleAmount ?? p.idleUsdc ?? 0n;
  const asset = p.asset ?? "USDC";
  const vaultName = p.vaultName ?? "Aave";
  const networkName = p.networkName ?? "Arbitrum One";
  const targetChainId = p.toChainId ?? ARBITRUM_CHAIN_ID;

  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const wagmiConfig = useConfig();
  const walletChainName = wagmiConfig.chains.find((c) => c.id === walletChainId)?.name;
  const isWrongChain = isConnected && walletChainId !== targetChainId && !(LOCAL_FORK_ENABLED && walletChainId === LOCAL_FORK_CHAIN_ID);

  return (
    <Dialog open={p.open} onClose={p.onClose} labelledBy={id} testId="bridge-dialog" dismissible={!p.busy}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-bold text-fg">Bridge &amp; Deposit</h2>
          <p className="mt-1 text-xs text-muted">
            Pay with any token from any network. It arrives as {asset} in your own Safe on {networkName}; then one click puts it to work in {vaultName}.
          </p>
        </div>
        <button type="button" aria-label="Close" disabled={p.busy} onClick={p.onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg disabled:opacity-40">
          ✕
        </button>
      </div>

      {isWrongChain && (
        <div data-testid="bridge-chain-notice" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-muted">
          <span>
            Connected on <span className="font-semibold text-fg">{walletChainName ?? "another network"}</span>.
          </span>
          <button
            type="button"
            data-testid="bridge-switch-network"
            onClick={() => void switchOrAddChain(wagmiConfig, targetChainId).catch(() => {})}
            className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-1 font-semibold text-cyan hover:bg-cyan/20 transition-all text-xs"
          >
            Switch wallet to {networkName}
          </button>
        </div>
      )}

      {(idle > 0n || started) && (
        <div data-testid="bridge-idle" className="mb-4 space-y-3 rounded-xl border border-emerald/30 bg-emerald/10 p-3">
          {!p.success && (
            <>
              <p className="text-sm text-fg">
                <span className="font-semibold">{fmtUsdc(idle)} {asset}</span> is in your Safe, not earning yet.
              </p>
              <button
                type="button"
                data-testid="bridge-supply"
                disabled={p.busy || idle <= 0n}
                onClick={() => p.onSupply(idle)}
                className="min-h-12 w-full rounded-xl bg-emerald px-6 text-sm font-semibold text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {p.busy ? "Working…" : `Supply to ${vaultName}`}
              </button>
            </>
          )}
          {started && <TxSteps steps={p.steps} explorer={p.explorer} />}
          {p.error && (
            <div role="alert" data-testid="bridge-error" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              {p.error}
            </div>
          )}
          {p.success && (
            <div role="status" data-testid="bridge-success" className="text-sm text-emerald">
              {p.success}
            </div>
          )}
        </div>
      )}

      <BridgeDepositWidget safe={p.safe} toChainId={p.toChainId} toTokenAddress={p.toTokenAddress} onConnect={p.onConnect} />
    </Dialog>
  );
}
