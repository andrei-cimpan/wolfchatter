import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-database";

// Tests empty the database they run against, so they must refuse anything but the local stack.
describe("assertLocalDatabase", () => {
  it("refuses a hosted Supabase database", () => {
    expect(() => assertLocalDatabase("postgresql://postgres:postgres@db.abc.supabase.co:5432/postgres")).toThrow();
  });

  it("refuses a missing URL", () => {
    expect(() => assertLocalDatabase("")).toThrow();
  });

  it("allows the local stack by address or by name", () => {
    expect(() => assertLocalDatabase("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).not.toThrow();
    expect(() => assertLocalDatabase("postgresql://postgres:postgres@localhost:54322/postgres")).not.toThrow();
  });
});
