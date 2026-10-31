import { describe, expect, it } from "vitest";
import { testDatabaseName } from "./global-setup";

const DEV = "postgres://u:p@localhost:5432/wolfchatter";

describe("testDatabaseName", () => {
  it("accepts a database ending in _test", () => {
    expect(testDatabaseName("postgres://u:p@localhost:5432/wolfchatter_test", DEV)).toBe("wolfchatter_test");
  });

  it("refuses a missing URL", () => {
    expect(() => testDatabaseName(undefined, DEV)).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("refuses the dev database", () => {
    expect(() => testDatabaseName(DEV, DEV)).toThrow(/must differ/);
  });

  it.each(["staging", "wolfchatter_testing", 'x_test"; drop database y; --'])(
    "refuses database name %j",
    (name) => {
      expect(() => testDatabaseName(`postgres://u:p@localhost:5432/${name}`, DEV)).toThrow(/ending in _test/);
    },
  );
});
