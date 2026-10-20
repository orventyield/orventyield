"use client";

import { LiFiWidget, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import { useSourceFunds } from "@/features/deposit/useSourceFunds";

// Module-level so the provider factory identity is stable across renders.
const ethereum = EthereumProvider();

export function BridgeDepositWidgetInner({ config }: { config: WidgetConfig }) {
  const { check, hint } = useSourceFunds();
  return (
    <div className="space-y-3">
      <LiFiWidget integrator={config.integrator} config={{ ...config, providers: [ethereum] }} />
      {check.kind !== "ok" && (
        <div role="alert" data-testid="bridge-funds-warning" className="rounded-xl border border-amber/30 bg-amber/10 p-3 text-xs text-amber">
          {check.message}
        </div>
      )}
      <p data-testid="bridge-gas-hint" className="px-1 text-[11px] text-muted">{hint}</p>
    </div>
  );
}
