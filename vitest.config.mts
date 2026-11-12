import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// CI sets these directly; locally they come from .env.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,mts}"],
    globalSetup: ["src/server/repositories/test/global-setup.ts"],
    // Code under test reads DATABASE_URL, so tests point it at the local Supabase database, which
    // they empty: the dev app's data there does not survive a test run.
    env: { DATABASE_URL: process.env.SUPABASE_DB_URL ?? "" },
    // Database tests truncate shared tables; running files in parallel would race.
    fileParallelism: false,
  },
});
