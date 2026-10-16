import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fully static site: deployable to any static host (Cloudflare Pages, etc.)
  output: "export",
};

export default nextConfig;
