import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { assertLocalSupabaseDatabase } from "./local-database";

// Registers hooks that give each test empty tables in the local Supabase database (SUPABASE_DB_URL).
// vitest.config.mts runs files one at a time, so one file cannot truncate another's rows.
export function setupTestDatabase(): () => pg.Pool {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    // The URL this pool empties, checked here rather than trusted from the config.
    await assertLocalSupabaseDatabase(process.env.SUPABASE_DB_URL ?? "");
    pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL });
  });
  beforeEach(async () => {
    await pool!.query("truncate messages, rooms restart identity cascade");
    await pool!.query("alter sequence room_number_seq restart");
  });
  afterAll(async () => {
    await pool?.end();
  });

  return () => {
    if (!pool) throw new Error("setupTestDatabase() pool is only available inside tests.");
    return pool;
  };
}
