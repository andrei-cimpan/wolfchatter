import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// CI sets these directly; locally they come from .env.
if (existsSync(".env")) process.loadEnvFile(".env");

// Not 3000, so a running `npm run dev` (pointed at the dev database) is never reused for tests.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Process env wins over .env in Next.js, so the app writes to the e2e database.
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      // Every test browser posts from the same address, so the per-IP limits would turn busy tests
      // (such as creating enough rooms to cluster) into 429s. A reused local server keeps its own env.
      RATE_LIMIT_ROOMS_PER_MINUTE: "10000",
      RATE_LIMIT_MESSAGES_PER_MINUTE: "10000",
    },
  },
});
