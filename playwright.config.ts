import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Every test browser posts from the same address, so the per-IP limits would turn busy tests
    // (such as creating enough rooms to cluster) into 429s. A reused local server keeps its own env.
    env: {
      RATE_LIMIT_ROOMS_PER_MINUTE: "10000",
      RATE_LIMIT_MESSAGES_PER_MINUTE: "10000",
    },
  },
});
