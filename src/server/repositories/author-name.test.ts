import { describe, expect, it } from "vitest";
import { anonClient } from "./test/supabase-client";
import { setupTestDatabase } from "./test/test-db";
import { createTestUser } from "./test/test-users";

const db = setupTestDatabase();

async function formatAuthor(identity: object): Promise<string> {
  const { rows } = await db().query<{ name: string }>("select public.format_author($1::jsonb) as name", [
    JSON.stringify(identity),
  ]);
  return rows[0]!.name;
}

describe("format_author", () => {
  it.each([
    [{ given_name: "Ana", family_name: "Popescu" }, "Ana P."],
    [{ given_name: "Ana Maria", family_name: "Popescu" }, "Ana Maria P."],
    [{ full_name: "Ana Maria Popescu" }, "Ana P."],
    [{ full_name: "Ana" }, "Ana"],
    [{ name: "  Ana   Popescu " }, "Ana P."],
    [{ full_name: "Ana Élan" }, "Ana É."],
    [{ given_name: "😀", family_name: "Popescu" }, "😀 P."],
    [{ full_name: "   " }, "Anonymous"],
    [{}, "Anonymous"],
  ])("formats %j as %s", async (identity, expected) => {
    expect(await formatAuthor(identity)).toBe(expected);
  });

  // PR #33 review #8: characters that draw nothing, or turn the text around it, are not a name.
  it.each([
    [{ full_name: "​" }, "Anonymous"],
    [{ full_name: "­" }, "Anonymous"],
    [{ full_name: "⁠﻿" }, "Anonymous"],
    [{ full_name: "‮evil" }, "evil"],
    [{ given_name: "An​a", family_name: "⁧Popescu" }, "Ana P."],
    [{ given_name: "Ana", family_name: "́Popescu" }, "Ana P."],
  ])("formats %j as %s", async (identity, expected) => {
    expect(await formatAuthor(identity)).toBe(expected);
  });

  it("does not leave half an emoji when cutting a long name", async () => {
    const family = "👨‍👩‍👧‍👦";
    const name = await formatAuthor({ given_name: `ab${family.repeat(10)}`, family_name: "Popescu" });
    expect([...name].length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/[^‍] P\.$/u);
  });

  it("keeps a long first name within the author limit", async () => {
    const name = await formatAuthor({ given_name: "a".repeat(40), family_name: "Popescu" });
    expect(name).toBe(`${"a".repeat(29)} P.`);
    expect([...name]).toHaveLength(32);
  });

  // What Google sent for a real account: full_name and name, no given or family name.
  it("formats an identity shaped like Google's", async () => {
    expect(await formatAuthor({ full_name: "Ana Popescu", name: "Ana Popescu", email: "ana@example.test" })).toBe(
      "Ana P.",
    );
  });
});

describe("current_author_name", () => {
  it("is null when signed out", async () => {
    const { data, error } = await anonClient().rpc("current_author_name");
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("is the signed-in user's formatted name", async () => {
    const { client } = await createTestUser({ full_name: "Ana Maria Popescu" });
    const { data, error } = await client.rpc("current_author_name");
    expect(error).toBeNull();
    expect(data).toBe("Ana P.");
  });
});
