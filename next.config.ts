import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fully static site: deployable to any static host (Cloudflare Pages, etc.)
  output: "export",
  // Always inlined (even when unset) so the local-fork code is dead-code-eliminated from production bundles.
  env: { NEXT_PUBLIC_ENABLE_LOCAL_FORK: process.env.NEXT_PUBLIC_ENABLE_LOCAL_FORK === "true" ? "true" : "false" },
  // Dev gets its own cache dir so `next build` (which exports to ./out) never clobbers a running dev server.
  // @lifi/widget-provider-ethereum imports the whole wagmi connectors barrel, which reaches optional x402 peers we never use.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"].map((m) => [m, false])),
    };
    return config;
  },
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
};

export default nextConfig;
