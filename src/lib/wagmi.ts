import { defineChain, type Chain } from "viem";
import { http, createConfig, type Transport } from "wagmi";
import { arbitrum, base, scroll } from "wagmi/chains";

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

const forkChain: Chain | null = FORK
  ? defineChain({
      id: LOCAL_FORK_CHAIN_ID,
      name: "Local Anvil fork",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_LOCAL_FORK_RPC || "http://127.0.0.1:8545"] } },
    })
  : null;

const publicChains = [arbitrum, base, scroll] as const;

const transports: Record<number, Transport> = {
  [arbitrum.id]: http(),
  [base.id]: http(),
  [scroll.id]: http(),
};
if (forkChain) transports[forkChain.id] = http();

export const wagmiConfig = createConfig({
  chains: forkChain ? ([...publicChains, forkChain] as unknown as typeof publicChains) : publicChains,
  transports: transports as Record<(typeof publicChains)[number]["id"], Transport>,
  ssr: true,
});

export const CHAIN_OPTIONS = [
  { id: arbitrum.id as number, label: "Arbitrum One" },
  { id: base.id as number, label: "Base" },
  { id: scroll.id as number, label: "Scroll" },
  ...(FORK ? [{ id: LOCAL_FORK_CHAIN_ID, label: "Local Anvil fork" }] : []),
];
