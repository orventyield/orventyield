import { defineConfig } from "vitest/config";

// Unit and integration tests only; tests/e2e is run by Playwright.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    passWithNoTests: true,
  },
});
