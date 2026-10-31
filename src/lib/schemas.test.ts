import { describe, expect, it } from "vitest";
import {
  createRoomSchema,
  listMessagesQuerySchema,
  mapItemsQuerySchema,
  postMessageSchema,
  roomIdSchema,
} from "./schemas";

const ID = "3f2b8c1e-9d4a-4c6b-8e2f-1a7d5b9c0e34";
const OTHER_ID = "7a1c9e2d-4b6f-4a8e-9c3d-5e7f1b2a4c6d";

describe("roomIdSchema", () => {
  it("accepts a uuid", () => {
    expect(roomIdSchema.parse(ID)).toBe(ID);
  });

  it.each(["", "not-a-uuid", `${ID}x`])("rejects %j", (id) => {
    expect(roomIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("createRoomSchema", () => {
  it.each([
    [44.43, 26.1],
    [90, 180],
    [-90, -180],
  ])("accepts lat %d, lng %d", (lat, lng) => {
    expect(createRoomSchema.safeParse({ lat, lng }).success).toBe(true);
  });

  it.each([
    [90.0001, 0],
    [-90.0001, 0],
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
    [0, Number.NEGATIVE_INFINITY],
    ["44", 26],
    [undefined, 26],
  ])("rejects lat %s, lng %s", (lat, lng) => {
    expect(createRoomSchema.safeParse({ lat, lng }).success).toBe(false);
  });

  it("wraps a longitude from a repeated copy of the world", () => {
    expect(createRoomSchema.parse({ lat: 0, lng: 200 })).toEqual({ lat: 0, lng: -160 });
  });
});

describe("postMessageSchema", () => {
  it("trims author and body but keeps line breaks inside the body", () => {
    expect(postMessageSchema.parse({ author: "  ana ", body: " line 1\nline 2 \n" })).toEqual({
      author: "ana",
      body: "line 1\nline 2",
    });
  });

  it("accepts the maximum lengths", () => {
    expect(postMessageSchema.safeParse({ author: "a".repeat(32), body: "b".repeat(1000) }).success).toBe(true);
  });

  it.each([
    ["empty author", "", "hi"],
    ["whitespace-only author", "   ", "hi"],
    ["over-long author", "a".repeat(33), "hi"],
    ["empty body", "ana", ""],
    ["whitespace-only body", "ana", " \n\t "],
    ["over-long body", "ana", "b".repeat(1001)],
  ])("rejects an %s", (_label, author, body) => {
    expect(postMessageSchema.safeParse({ author, body }).success).toBe(false);
  });

  it("counts characters the way Postgres does, not UTF-16 units", () => {
    const emoji = "🐺";
    expect(emoji.length).toBe(2);
    expect(postMessageSchema.safeParse({ author: "ana", body: emoji.repeat(1000) }).success).toBe(true);
    expect(postMessageSchema.safeParse({ author: "ana", body: emoji.repeat(1001) }).success).toBe(false);
    expect(postMessageSchema.safeParse({ author: emoji.repeat(32), body: "hi" }).success).toBe(true);
  });

  it.each([
    ["a NUL character", "a\u0000b"],
    ["a lone surrogate", "a\uD800b"],
  ])("rejects text Postgres cannot store as sent: %s", (_label, text) => {
    expect(postMessageSchema.safeParse({ author: "ana", body: text }).success).toBe(false);
    expect(postMessageSchema.safeParse({ author: text, body: "hi" }).success).toBe(false);
  });

  // trim() keeps these, and a message made only of them renders as a blank bubble.
  it.each([
    ["zero-width spaces", "\u200B\u200B"],
    ["a next-line control", "\u0085"],
    ["a zero-width joiner and BOM", "\u200D\uFEFF"],
    ["a word joiner and soft hyphen", "\u2060\u00AD"],
    ["Hangul fillers", "\u3164\u115F\uFFA0"],
    ["a braille blank", "\u2800"],
    ["a mix with ordinary spaces", " \u200B \u0085 "],
  ])("rejects text made only of invisible characters: %s", (_label, text) => {
    for (const input of [{ author: text, body: "hi" }, { author: "ana", body: text }]) {
      const result = postMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/is required$/);
    }
  });

  it.each([
    ["an emoji built with a joiner", "👩\u200D💻"],
    ["a word next to a zero-width space", "\u200Bhi"],
  ])("accepts visible text that contains invisible characters: %s", (_label, text) => {
    expect(postMessageSchema.safeParse({ author: text, body: text }).success).toBe(true);
  });

  it("names the field in the error message", () => {
    const result = postMessageSchema.safeParse({ author: "", body: "hi" });
    expect(result.error?.issues[0]).toMatchObject({ path: ["author"], message: "Author is required" });
  });
});

describe("mapItemsQuerySchema", () => {
  it("parses bbox and zoom from query strings", () => {
    expect(mapItemsQuerySchema.parse({ bbox: "20,40,30,46", zoom: "7" })).toEqual({
      bbox: { west: 20, south: 40, east: 30, north: 46 },
      zoom: 7,
    });
  });

  it("ignores whitespace around query numbers", () => {
    expect(mapItemsQuerySchema.parse({ bbox: " 1, 2 ,3,4 ", zoom: " 7 " })).toMatchObject({ zoom: 7 });
  });

  it("accepts negative, fractional and exponent forms", () => {
    expect(mapItemsQuerySchema.parse({ bbox: "-0.5,.25,1e-7,4.5E1", zoom: "3" }).bbox).toEqual({
      west: -0.5,
      south: 0.25,
      east: 1e-7,
      north: 45,
    });
  });

  it("wraps Leaflet's unwrapped longitudes", () => {
    expect(mapItemsQuerySchema.parse({ bbox: "170,-10,190,10", zoom: "5" }).bbox).toEqual({
      west: 170,
      south: -10,
      east: -170,
      north: 10,
    });
  });

  it("accepts already-wrapped bounds that cross the antimeridian", () => {
    expect(mapItemsQuerySchema.parse({ bbox: "170,-10,-170,10", zoom: "5" }).bbox).toMatchObject({
      west: 170,
      east: -170,
    });
  });

  it.each([
    ["three values", "1,2,3"],
    ["five values", "1,2,3,4,5"],
    ["letters", "a,b,c,d"],
    ["an empty value", "1,,3,4"],
    ["an empty string", ""],
    ["an infinite value", "1e400,2,3,4"],
    ["NaN", "NaN,2,3,4"],
    ["a hex value", "0x10,2,3,4"],
    ["a binary value", "0b11,2,3,4"],
    ["a plus sign", "+1,2,3,4"],
    ["a trailing dot", "1.,2,3,4"],
    ["south above north", "0,10,1,5"],
    ["west above east outside ±180", "200,0,10,1"],
    ["west above east with east below -180", "170,0,-190,1"],
  ])("rejects a bbox with %s", (_label, bbox) => {
    expect(mapItemsQuerySchema.safeParse({ bbox, zoom: "5" }).success).toBe(false);
  });

  it.each(["", "   ", "2.5", "-1", "23", "abc", "Infinity", "0x10", "+5"])("rejects zoom %j", (zoom) => {
    expect(mapItemsQuerySchema.safeParse({ bbox: "0,0,1,1", zoom }).success).toBe(false);
  });

  it("requires bbox and zoom", () => {
    expect(mapItemsQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("listMessagesQuerySchema", () => {
  it("accepts an empty query", () => {
    expect(listMessagesQuerySchema.parse({})).toEqual({});
  });

  it("parses cursors and limit", () => {
    expect(listMessagesQuerySchema.parse({ before: ID, limit: "20" })).toEqual({ before: ID, limit: 20 });
    expect(listMessagesQuerySchema.parse({ after: ID })).toEqual({ after: ID });
  });

  it.each(["0", "101", "2.5", "abc", "NaN", "Infinity", "", "   "])("rejects limit %j", (limit) => {
    expect(listMessagesQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it("rejects a malformed cursor", () => {
    expect(listMessagesQuerySchema.safeParse({ before: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects before and after together", () => {
    const result = listMessagesQuerySchema.safeParse({ before: ID, after: OTHER_ID });
    expect(result.error?.issues[0]).toMatchObject({ path: ["after"], message: "Use before or after, not both" });
  });
});
