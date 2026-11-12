import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { assertLocalDatabase } from "./local-database";

// Registers hooks that give each test empty tables. vitest.config.mts points DATABASE_URL at the
// local Supabase database and runs files one at a time, so one file cannot truncate another's rows.
export function setupTestDatabase(): () => pg.Pool {
  let pool: pg.Pool | undefined;

  beforeAll(() => {
    // The URL this pool empties, checked here rather than trusted from the config.
    assertLocalDatabase(process.env.DATABASE_URL ?? "");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
