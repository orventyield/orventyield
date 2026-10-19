"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { ConnectWalletModal } from "@/components/wallet/ConnectWalletModal";
import { IdentityProvider } from "@/features/identity/IdentityProvider";
import { AppModeProvider } from "@/features/mode/AppModeProvider";
import { wagmiConfig } from "@/lib/wagmi";

/** Wallet, data and app-mode providers. Mounted only on /dashboard so marketing pages stay light. */
export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppModeProvider>
          <IdentityProvider>
            {children}
            <ConnectWalletModal />
          </IdentityProvider>
        </AppModeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
