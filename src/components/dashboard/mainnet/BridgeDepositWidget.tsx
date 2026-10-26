"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { Address } from "viem";
import { buildLifiWidgetConfig } from "@/features/deposit/lifiWidgetConfig";

/**
 * Lazy LI.FI widget. Everything from @lifi/widget (MUI, emotion, the SDK, ~4 MB unpacked) loads in its own client-only
 * chunk, and only when this component renders. It reuses our WagmiProvider (EthereumProvider detects the WagmiContext),
 * so there is no second wallet stack.
 *
 * SECURITY: unlike the sandboxed iframes in frontend rule 9, this is third-party code running in our origin with access
 * to the connected wallet provider. Pin the version and review upgrades.
 */
const Widget = dynamic(() => import("./BridgeDepositWidgetInner").then((m) => m.BridgeDepositWidgetInner), {
  ssr: false,
  loading: () => (
    <div role="status" aria-live="polite" className="grid h-[480px] place-items-center rounded-2xl border border-line bg-surface text-sm text-muted">
      Loading bridge...
    </div>
  ),
});

interface Props {
  /** The user's Safe: destination is locked to it. */
  safe: Address;
  /** Destination chain ID (defaults to Arbitrum One: 42161). Set to 4663 for Robinhood Chain. */
  toChainId?: number;
  /** Destination token address (defaults to native USDC on Arbitrum, or Paxos USDG on Robinhood Chain). */
  toTokenAddress?: Address;
  /** USDC base units. When set, funds also get supplied to Aave on arrival (see lifiWidgetConfig.ts). */
  supplyAmount?: bigint;
  /** Called when the widget's own "Connect wallet" button is pressed. */
  onConnect?: () => void;
}

export function BridgeDepositWidget({ safe, toChainId, toTokenAddress, supplyAmount, onConnect }: Props) {
  const config = useMemo(
    () => buildLifiWidgetConfig({ safe, toChainId, toTokenAddress, supplyAmount, onConnect }),
    [safe, toChainId, toTokenAddress, supplyAmount, onConnect],
  );
  return <Widget config={config} />;
}
