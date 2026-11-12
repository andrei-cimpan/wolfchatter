import { execFileSync } from "node:child_process";
import pg from "pg";
import { assertLocalSupabaseDatabase } from "../src/server/repositories/test/local-database";

// E2E tests create rooms through the real app in the local Supabase database, emptied once per
// run. Tests must not depend on each other's rooms; emptying only keeps the map from filling up.
// Unit tests empty the same database, so the two suites must not run at the same time.
export default async function globalSetup(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL ?? "";
  await assertLocalSupabaseDatabase(url);
  // Applies migrations written since the stack started, as v1's setup migrated its database.
  execFileSync("npx", ["supabase", "migration", "up", "--local"], { stdio: "inherit" });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("truncate rooms cascade");
  } finally {
    await client.end();
  }
}
