import { execFileSync } from "node:child_process";
import { assertLocalSupabaseDatabase } from "./local-database";

export default async function setup(): Promise<void> {
  try {
    await assertLocalSupabaseDatabase(process.env.SUPABASE_DB_URL ?? "");
    // `supabase start` applies the migrations it finds; this adds any written since, as v1's runner
    // migrated its test database on every run.
    execFileSync("npx", ["supabase", "migration", "up"], { stdio: "pipe" });
  } catch (error) {
    // Vitest 5 loses global setup errors while formatting their stack trace and prints only
    // "No test files found", so say what went wrong before failing.
    console.error(`\nTest database setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}
