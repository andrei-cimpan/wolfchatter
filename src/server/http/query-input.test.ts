import { describe, expect, it } from "vitest";
import { listMessagesQuerySchema } from "@/lib/schemas";
import { queryInput } from "./query-input";

const KEYS = ["before", "after", "limit"] as const;
const parse = (query: string) => queryInput(new URLSearchParams(query), KEYS);

describe("queryInput", () => {
  it("reads the given keys and leaves missing ones undefined", () => {
    expect(parse("limit=5")).toEqual({ before: undefined, after: undefined, limit: "5" });
  });

  it("keeps empty values as empty strings", () => {
    expect(parse("before=&limit=")).toEqual({ before: "", after: undefined, limit: "" });
  });

  it("uses the first value of a repeated key", () => {
    expect(parse("limit=5&limit=7").limit).toBe("5");
  });

  it("ignores keys it was not asked for", () => {
    expect(Object.keys(parse("limit=5&_=123&constructor=x"))).toEqual([...KEYS]);
  });

  it("feeds schemas so that empty values are rejected, not treated as absent", () => {
    expect(listMessagesQuerySchema.safeParse(parse("")).success).toBe(true);
    expect(listMessagesQuerySchema.safeParse(parse("before=")).success).toBe(false);
    expect(listMessagesQuerySchema.safeParse(parse("limit=")).success).toBe(false);
    expect(listMessagesQuerySchema.safeParse(parse("limit=5&limit=abc")).data).toEqual({ limit: 5 });
  });
});
