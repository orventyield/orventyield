import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const API = process.env.API === "1";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [
    // Default run: the browser uses the built-in demo verifier (no server needed).
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /identity-api\.spec\.ts/ },
    // API=1: a second app instance talks to the real verification Worker (local D1, mock OTP provider).
    ...(API ? [{ name: "api", testMatch: /identity-api\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3200" } }] : []),
  ],
  webServer: [
    {
      // Empty value beats .env.local so e2e never talks to the live verify Worker (real SMS, 429s).
      // Own dist dir so a bundle compiled with the live Worker URL (the normal dev cache) is never reused.
      command: `NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_VERIFY_API_URL= npm run dev -- -p ${PORT}`,
      url: `${BASE}/dashboard`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    ...(API
      ? [
          { command: "rm -rf .wrangler-api && npm run api:dev", url: "http://localhost:8787/api/health", reuseExistingServer: true, timeout: 180_000 },
          {
            command: "NEXT_PUBLIC_VERIFY_API_URL=http://localhost:8787 NEXT_DIST_DIR=.next-dev-api npm run dev -- -p 3200",
            url: "http://localhost:3200/dashboard",
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
