import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";

// Registers hooks that give each test an empty schema. vitest.config.ts points DATABASE_URL at
// the test database and runs files one at a time, so one file cannot truncate another's rows.
export function setupTestDatabase(): () => pg.Pool {
  let pool: pg.Pool | undefined;

  beforeAll(() => {
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
