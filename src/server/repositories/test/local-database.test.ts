import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase, assertLocalSupabaseDatabase } from "./local-database";

// Tests empty the database they run against, so they must refuse anything but the local stack.
describe("assertLocalDatabase", () => {
  it("refuses a hosted Supabase database", () => {
    expect(() => assertLocalDatabase("postgresql://postgres:postgres@db.abc.supabase.co:5432/postgres")).toThrow();
  });

  it("refuses a URL whose query names another host, which pg connects to instead (review #1)", () => {
    expect(() =>
      assertLocalDatabase("postgresql://postgres:postgres@localhost:54322/postgres?host=db.abc.supabase.co"),
    ).toThrow();
  });

  it("refuses a missing URL", () => {
    expect(() => assertLocalDatabase("")).toThrow();
  });

  it("allows the local stack by address or by name", () => {
    expect(() => assertLocalDatabase("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).not.toThrow();
    expect(() => assertLocalDatabase("postgresql://postgres:postgres@localhost:54322/postgres")).not.toThrow();
  });
});

// A local Postgres that is not the Supabase stack, such as v1's on localhost:5432, passes the host
// check, so the database itself is checked before anything is emptied.
describe("assertLocalSupabaseDatabase", () => {
  const stackUrl = process.env.SUPABASE_DB_URL ?? "";
  const plainUrl = stackUrl.replace(/\/postgres$/, "/plain_postgres_check");

  async function admin(sql: string) {
    const client = new pg.Client({ connectionString: stackUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  beforeAll(() => admin("create database plain_postgres_check"));
  afterAll(() => admin("drop database if exists plain_postgres_check"));

  it("allows the local Supabase database", async () => {
    await expect(assertLocalSupabaseDatabase(stackUrl)).resolves.toBeUndefined();
  });

  it("refuses a local database that is not the Supabase stack's", async () => {
    await expect(assertLocalSupabaseDatabase(plainUrl)).rejects.toThrow(/not the local Supabase database/);
  });
});
