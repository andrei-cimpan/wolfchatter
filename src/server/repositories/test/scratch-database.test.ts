import { describe, expect, it } from "vitest";
import { scratchDatabaseName } from "./scratch-database";

const DEV = "postgres://u:p@localhost:5432/wolfchatter";

describe("scratchDatabaseName for the e2e database", () => {
  const check = (url: string | undefined) => scratchDatabaseName("E2E_DATABASE_URL", url, DEV, "e2e");

  it("accepts a database ending in _e2e", () => {
    expect(check("postgres://u:p@localhost:5432/wolfchatter_e2e")).toBe("wolfchatter_e2e");
  });

  it("names the variable when it is missing", () => {
    expect(() => check(undefined)).toThrow(/E2E_DATABASE_URL is not set/);
  });

  it("refuses the dev database", () => {
    expect(() => check(DEV)).toThrow(/E2E_DATABASE_URL must differ/);
  });

  it("refuses the unit-test database", () => {
    expect(() => check("postgres://u:p@localhost:5432/wolfchatter_test")).toThrow(/ending in _e2e/);
  });
});
