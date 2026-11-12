import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { assertLocalSupabaseDatabase } from "./local-database";
import { TEST_EMAIL_DOMAIN } from "./test-users";

/**
 * Owns the rows tests insert directly with SQL, since every room and message needs an owner. It is
 * a bare user with no sign-in identity, recreated before each test.
 */
export const SEED_USER_ID = "00000000-0000-4000-8000-0000000000aa";

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
    // After the rooms, which reference their creators. Only users the tests made.
    await pool!.query("delete from auth.users where email like $1", [`%@${TEST_EMAIL_DOMAIN}`]);
    await pool!.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [
      SEED_USER_ID,
      `seed@${TEST_EMAIL_DOMAIN}`,
    ]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  return () => {
    if (!pool) throw new Error("setupTestDatabase() pool is only available inside tests.");
    return pool;
  };
}
