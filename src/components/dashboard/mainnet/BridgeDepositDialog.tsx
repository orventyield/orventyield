"use client";

import { useId } from "react";
import type { Address } from "viem";
import { BridgeDepositWidget } from "@/components/dashboard/mainnet/BridgeDepositWidget";
import { TxSteps } from "@/components/dashboard/mainnet/TxSteps";
import { Dialog } from "@/components/ui/Dialog";
import type { TxStep } from "@/features/account/useSafeAccount";
import { fmtUsdc } from "@/lib/aave/format";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The user's Safe on Arbitrum One: the bridge destination is locked to it. */
  safe: Address;
  /** USDC already sitting in the Safe (bridged in, not yet earning). */
  idleUsdc: bigint;
  steps: TxStep[];
  busy: boolean;
  error: string | null;
  success: string | null;
  explorer?: string;
  onSupply: (amount: bigint) => void;
  onConnect: () => void;
}

/** Bridge from any chain or token into the user's Safe, then one click to put it to work in Aave. */
export function BridgeDepositDialog(p: Props) {
  const id = useId();
  const started = p.steps.length > 0;
  return (
    <Dialog open={p.open} onClose={p.onClose} labelledBy={id} testId="bridge-dialog" dismissible={!p.busy}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-bold text-fg">Bridge &amp; Deposit</h2>
          <p className="mt-1 text-xs text-muted">
            Pay with any token from any network. It arrives as USDC in your own Safe; then one click puts it to work in Aave.
          </p>
        </div>
        <button type="button" aria-label="Close" disabled={p.busy} onClick={p.onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg disabled:opacity-40">
          ✕
        </button>
      </div>

      {(p.idleUsdc > 0n || started) && (
        <div data-testid="bridge-idle" className="mb-4 space-y-3 rounded-xl border border-emerald/30 bg-emerald/10 p-3">
          {!p.success && (
            <>
              <p className="text-sm text-fg">
                <span className="font-semibold">{fmtUsdc(p.idleUsdc)} USDC</span> is in your Safe, not earning yet.
              </p>
              <button
                type="button"
                data-testid="bridge-supply"
                disabled={p.busy || p.idleUsdc <= 0n}
                onClick={() => p.onSupply(p.idleUsdc)}
                className="min-h-12 w-full rounded-xl bg-emerald px-6 text-sm font-semibold text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {p.busy ? "Working…" : "Supply to Aave"}
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

      <BridgeDepositWidget safe={p.safe} onConnect={p.onConnect} />
    </Dialog>
  );
}
