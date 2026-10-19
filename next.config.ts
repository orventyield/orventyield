import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fully static site: deployable to any static host (Cloudflare Pages, etc.)
  output: "export",
  // Always inlined (even when unset) so the local-fork code is dead-code-eliminated from production bundles.
  env: { NEXT_PUBLIC_ENABLE_LOCAL_FORK: process.env.NEXT_PUBLIC_ENABLE_LOCAL_FORK === "true" ? "true" : "false" },
  // Dev gets its own cache dir so `next build` (which exports to ./out) never clobbers a running dev server.
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
};

export default nextConfig;
