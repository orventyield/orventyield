import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Empty value beats .env.local so e2e never talks to the live Worker (real orders, rate limits).
      // Own dist dir so a bundle compiled with the live Worker URL (the normal dev cache) is never reused.
      command: `NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_VERIFY_API_URL= NEXT_PUBLIC_VOUCHER_API_URL=https://vouchers.e2e.test npm run dev -- -p ${PORT}`,
      url: `${BASE}/dashboard`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
