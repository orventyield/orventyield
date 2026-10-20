"use client";

import { LiFiWidget, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";

// Module-level so the provider factory identity is stable across renders.
const ethereum = EthereumProvider();

export function BridgeDepositWidgetInner({ config }: { config: WidgetConfig }) {
  return <LiFiWidget integrator={config.integrator} config={{ ...config, providers: [ethereum] }} />;
}
