import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// CI sets these directly; locally they come from .env.
if (existsSync(".env")) process.loadEnvFile(".env");

// Not 3000, so a running `npm run dev` (pointed at the dev database) is never reused for tests.
// E2E_PORT lets another checkout run its dev server beside this one, though not its e2e: both
// suites empty the one local Supabase database.
const PORT = Number(process.env.E2E_PORT || 3100);
// Reusing a server is opt-in: otherwise a server already on the port, perhaps another checkout's
// with other code and env, would be tested silently. Without it, a busy port fails loudly.
const REUSE_SERVER = !process.env.CI && process.env.E2E_REUSE_SERVER === "1";

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
    reuseExistingServer: REUSE_SERVER,
    timeout: 120_000,
  },
});
