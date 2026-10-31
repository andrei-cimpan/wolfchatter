import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// CI sets these directly; locally they come from .env.
if (existsSync(".env")) process.loadEnvFile(".env");
// Captured before tests swap DATABASE_URL, so global setup can refuse to truncate the dev database.
process.env.APP_DATABASE_URL = process.env.DATABASE_URL ?? "";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,mts}", "scripts/**/*.test.{ts,mts}"],
    globalSetup: ["src/server/repositories/test/global-setup.ts"],
    // Code under test reads DATABASE_URL, so tests point it at the test database.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
    // Database tests truncate shared tables; running files in parallel would race.
    fileParallelism: false,
  },
});
