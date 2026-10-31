import { describe, expect, it } from "vitest";
import { assertRunsInTransaction, pendingMigrations } from "./migrate.mts";

describe("pendingMigrations", () => {
  it("returns unapplied migrations in name order", () => {
    const files = ["0002_b.sql", "0001_a.sql", "0003_c.sql"];
    expect(pendingMigrations(files, new Set(["0001_a.sql"]))).toEqual(["0002_b.sql", "0003_c.sql"]);
  });

  it("returns nothing when every migration is applied", () => {
    expect(pendingMigrations(["0001_a.sql"], new Set(["0001_a.sql"]))).toEqual([]);
  });

  it("ignores files that are not SQL", () => {
    expect(pendingMigrations([".gitkeep", "README.md", "0001_a.sql"], new Set())).toEqual(["0001_a.sql"]);
  });

  it("rejects SQL files that do not follow NNNN_name.sql", () => {
    expect(() => pendingMigrations(["1_init.sql"], new Set())).toThrow(/NNNN_name\.sql: 1_init\.sql/);
  });
});

describe("assertRunsInTransaction", () => {
  it("allows plain DDL and PL/pgSQL begin/end blocks", () => {
    const sql = `
      create table t (id int);
      create function f() returns trigger as $$
      begin
        return new;
      end;
      $$ language plpgsql;`;
    expect(() => assertRunsInTransaction("0001_ok.sql", sql)).not.toThrow();
  });

  it.each([
    "begin;\ncreate table t (id int);\ncommit;",
    "BEGIN TRANSACTION;",
    "start transaction;",
    "create table t (id int);\nCOMMIT;",
    "end transaction;",
    "rollback;",
    "create index concurrently t_idx on t (id);",
  ])("rejects %j", (sql) => {
    expect(() => assertRunsInTransaction("0002_bad.sql", sql)).toThrow(
      /0002_bad\.sql manages its own transaction/,
    );
  });
});
