import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "./db";

afterAll(() => getPool().end());

describe("getPool", () => {
  // Without an 'error' listener, Node treats this as an unhandled event and exits the process.
  it("survives an idle connection being killed and reconnects", async () => {
    const pool = getPool();
    const { rows } = await pool.query<{ pid: number }>("select pg_backend_pid() as pid");

    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query("select pg_terminate_backend($1)", [rows[0]!.pid]);
    await admin.end();
    await expect.poll(() => pool.totalCount).toBe(0);

    const { rows: after } = await pool.query<{ ok: number }>("select 1 as ok");
    expect(after[0]?.ok).toBe(1);
  });
});
