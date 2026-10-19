import { defineChain, type Chain } from "viem";
import { http, createConfig, type Transport } from "wagmi";
import { arbitrum } from "wagmi/chains";
// Subpath imports avoid the connectors barrel, which pulls in optional SDKs we do not use.
import { coinbaseWallet } from "wagmi/connectors/coinbaseWallet";
import { injected } from "wagmi/connectors/injected";
import { walletConnect } from "wagmi/connectors/walletConnect";

/**
 * Local Anvil fork (scripts/anvil-fork.sh, chain id 31337 at http://127.0.0.1:8545).
 * Enabled in development, or in a production build when NEXT_PUBLIC_ENABLE_LOCAL_FORK=true.
 * Never enabled on the public site: browsers block a public page from calling a loopback RPC.
 *
 * Everything that mentions the fork is behind FORK so production bundles drop it entirely.
 */
// Module-local (not exported) so the minifier can fold the ternaries below in production builds.
const FORK = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_LOCAL_FORK === "true";
export const LOCAL_FORK_ENABLED: boolean = FORK;

/** Anvil's default chain id. */
export const LOCAL_FORK_CHAIN_ID = 31337;

/** The chain OrventYield runs on: Safe v1.4.1 + Aave v3 on Arbitrum One. */
export const APP_CHAIN_ID = arbitrum.id;

/** Free project id from https://cloud.reown.com. Without it the WalletConnect (QR) option is hidden. */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const forkChain: Chain | null = FORK
  ? defineChain({
      id: LOCAL_FORK_CHAIN_ID,
      name: "Local Anvil fork",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_LOCAL_FORK_RPC || "http://127.0.0.1:8545"] } },
    })
  : null;

const publicChains = [arbitrum] as const;

const transports: Record<number, Transport> = {
  [arbitrum.id]: http(process.env.NEXT_PUBLIC_RPC_ARBITRUM || undefined),
};
if (forkChain) transports[forkChain.id] = http();

const appUrl = typeof window !== "undefined" ? window.location.origin : "https://orventyield.tech";

export const wagmiConfig = createConfig({
  chains: forkChain ? ([...publicChains, forkChain] as unknown as typeof publicChains) : publicChains,
  transports: transports as Record<(typeof publicChains)[number]["id"], Transport>,
  // Browser extensions are discovered automatically (EIP-6963); `injected()` is the legacy window.ethereum fallback.
  connectors: [
    injected(),
    coinbaseWallet({ appName: "OrventYield" }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            metadata: {
              name: "OrventYield",
              description: "Spend the yield. Keep the principal.",
              url: appUrl,
              icons: [`${appUrl}/icon.svg`],
            },
          }),
        ]
      : []),
  ],
  ssr: true,
});

export const CHAIN_OPTIONS = [
  { id: arbitrum.id as number, label: "Arbitrum One" },
  ...(FORK ? [{ id: LOCAL_FORK_CHAIN_ID, label: "Local Anvil fork" }] : []),
];
