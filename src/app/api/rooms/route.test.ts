import { beforeEach, describe, expect, it } from "vitest";
import type { MapItem, Message, Room } from "@/lib/types";
import { sessionCookieHeader } from "@/server/repositories/test/session-cookies";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { createTestUser } from "@/server/repositories/test/test-users";
import { GET, POST } from "./route";

setupTestDatabase();

// Requests come from a signed-in user unless a test sends `cookie: ""`.
let cookie: string;
beforeEach(async () => {
  cookie = await sessionCookieHeader((await createTestUser({ full_name: "Ana Popescu" })).session);
});

function getRooms(query: string): Promise<Response> {
  return GET(new Request(`http://test/api/rooms${query}`));
}

function postRoom(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://test/api/rooms", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", cookie, ...headers },
    }),
  );
}

async function createRoom(lat: number, lng: number): Promise<Room> {
  return (await postRoom(JSON.stringify({ lat, lng }))).json();
}

async function expectError(response: Response, status: number, code: string): Promise<string> {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  return body.error.message;
}

describe("POST /api/rooms", () => {
  it("creates a room and points Location at it", async () => {
    const response = await postRoom(JSON.stringify({ lat: 44.43, lng: 26.1 }));
    expect(response.status).toBe(201);
    const room: Room = await response.json();
    expect(room).toMatchObject({ title: "Chatroom 1", lat: 44.43, lng: 26.1, messageCount: 0 });
    expect(response.headers.get("location")).toBe(`/api/rooms/${room.id}`);
  });

  it("saves a first message with the room, in one request", async () => {
    const response = await postRoom(
      JSON.stringify({ lat: 44.43, lng: 26.1, firstMessage: { author: "X", body: "hello" } }),
    );
    expect(response.status).toBe(201);
    const room: Room & { firstMessage: Message } = await response.json();
    expect(room).toMatchObject({ title: "Chatroom 1", messageCount: 1 });
    // The author is the signed-in user's, whatever the request sent.
    expect(room.firstMessage).toMatchObject({ roomId: room.id, author: "Ana P.", body: "hello" });
    expect(response.headers.get("location")).toBe(`/api/rooms/${room.id}`);
  });

  it("leaves the first message out of a room created without one", async () => {
    expect(await createRoom(1, 2)).not.toHaveProperty("firstMessage");
  });

  it.each([
    ["a body with nothing visible", { body: "​" }, /^firstMessage\.body: /],
    ["a missing body", {}, /^firstMessage\.body: /],
    ["a null message", null, /^firstMessage: /],
  ])("rejects a first message with %s, and creates no room", async (_label, firstMessage, message) => {
    const body = JSON.stringify({ lat: 67.5, lng: 12.5, firstMessage });
    expect(await expectError(await postRoom(body), 400, "validation_error")).toMatch(message);
    const rooms = await getRooms("?bbox=12,67,13,68&zoom=16");
    expect(await rooms.json()).toEqual([]);
  });

  it("wraps a longitude from a repeated copy of the world", async () => {
    const room = await createRoom(10, 200);
    expect(room.lng).toBe(-160);
  });

  it("creates a room for a longitude just below a wrap boundary", async () => {
    const response = await postRoom(JSON.stringify({ lat: 0, lng: 899.9999999999999 }));
    expect(response.status).toBe(201);
  });

  it.each([
    ["lat out of range", { lat: 91, lng: 0 }, /^lat: /],
    ["missing lng", { lat: 0 }, /^lng: /],
    ["string numbers", { lat: "1", lng: "2" }, /^lat: /],
    ["an array body", [1, 2], /./],
    ["a null body", null, /./],
  ])("rejects %s with 400", async (_label, body, message) => {
    expect(await expectError(await postRoom(JSON.stringify(body)), 400, "validation_error")).toMatch(message);
  });

  it("rejects an oversized body with 413", async () => {
    const body = JSON.stringify({ lat: 0, lng: 0, pad: "x".repeat(20_000) });
    await expectError(await postRoom(body), 413, "payload_too_large");
  });

  it.each(["", "{lat: 1}", "lat=1&lng=2"])("rejects the non-JSON body %j with 400", async (body) => {
    await expectError(await postRoom(body), 400, "invalid_json");
  });

  it.each(["", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data"])(
    "rejects Content-Type %j with 415",
    async (contentType) => {
      const response = await postRoom(JSON.stringify({ lat: 0, lng: 0 }), { "content-type": contentType });
      await expectError(response, 415, "unsupported_media_type");
    },
  );

  it("accepts application/json with a charset parameter", async () => {
    const response = await postRoom(JSON.stringify({ lat: 0, lng: 0 }), { "content-type": "Application/JSON; charset=utf-8" });
    expect(response.status).toBe(201);
  });

  it.each([
    ["a room", { lat: 1, lng: 2 }],
    ["a room with its first message", { lat: 1, lng: 2, firstMessage: { body: "hi" } }],
  ])("answers a signed-out request for %s with 401 unauthenticated, and stores nothing", async (_label, body) => {
    await expectError(await postRoom(JSON.stringify(body), { cookie: "" }), 401, "unauthenticated");
    expect(await (await getRooms("?bbox=-180,-90,180,90&zoom=16")).json()).toEqual([]);
  });

  it("answers an invalid signed-out request with 400", async () => {
    await expectError(await postRoom(JSON.stringify({ lat: 91, lng: 0 }), { cookie: "" }), 400, "validation_error");
  });

  it("rejects a first message with only an author with 400", async () => {
    const response = await postRoom(JSON.stringify({ lat: 1, lng: 2, firstMessage: { author: "ana" } }));
    expect(await expectError(response, 400, "validation_error")).toMatch(/^firstMessage\.body: /);
  });
});

describe("GET /api/rooms", () => {
  // A token the database will not accept (rotated keys, another project's cookie) must not make a
  // public read fail: reading needs no account (PR #33 review #4).
  it("answers as if signed out when the session cookie holds a token the database rejects", async () => {
    await createRoom(44.43, 26.1);
    const { session } = await createTestUser();
    const rejected = await sessionCookieHeader({ ...session, access_token: "garbage.token.here" });
    const response = await GET(new Request("http://test/api/rooms?bbox=-180,-90,180,90&zoom=16", { headers: { cookie: rejected } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
  });

  it("still answers 401 for a post with such a token", async () => {
    const { session } = await createTestUser();
    const rejected = await sessionCookieHeader({ ...session, access_token: "garbage.token.here" });
    await expectError(await postRoom(JSON.stringify({ lat: 1, lng: 2 }), { cookie: rejected }), 401, "unauthenticated");
  });

  it("returns rooms and clusters in the viewport", async () => {
    await createRoom(44.43, 26.1);
    await createRoom(44.44, 26.11);
    const far = await createRoom(-33.9, 151.2);

    const response = await getRooms("?bbox=-180,-90,180,90&zoom=3");
    expect(response.status).toBe(200);
    const items: MapItem[] = await response.json();
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(expect.objectContaining({ type: "cluster", count: 2 }));
    expect(items).toContainEqual({ type: "room", id: far.id, title: far.title, lat: far.lat, lng: far.lng, messageCount: 0 });
  });

  it("returns individual rooms from zoom 16", async () => {
    await createRoom(44.43, 26.1);
    await createRoom(44.4301, 26.1001);
    const items: MapItem[] = await (await getRooms("?bbox=26,44,27,45&zoom=16")).json();
    expect(items.map((i) => i.type)).toEqual(["room", "room"]);
  });

  it("only returns rooms inside the bbox", async () => {
    await createRoom(44.43, 26.1);
    expect(await (await getRooms("?bbox=0,0,10,10&zoom=5")).json()).toEqual([]);
  });

  it("accepts unwrapped bounds across the antimeridian", async () => {
    const east = await createRoom(0, 175);
    const west = await createRoom(0, -175);
    await createRoom(0, 0);
    const response = await getRooms("?bbox=170,-10,190,10&zoom=16");
    expect(response.status).toBe(200);
    const ids = ((await response.json()) as MapItem[]).map((i) => (i.type === "room" ? i.id : null));
    expect(ids.sort()).toEqual([east.id, west.id].sort());
  });

  it("accepts already-wrapped bounds that cross the antimeridian (west > east)", async () => {
    const east = await createRoom(0, 175);
    const west = await createRoom(0, -175);
    await createRoom(0, 0);
    const response = await getRooms("?bbox=170,-10,-170,10&zoom=16");
    expect(response.status).toBe(200);
    const ids = ((await response.json()) as MapItem[]).map((i) => (i.type === "room" ? i.id : null));
    expect(ids.sort()).toEqual([east.id, west.id].sort());
  });

  it.each([
    ["missing bbox", "?zoom=3", /^bbox: /],
    ["missing zoom", "?bbox=0,0,1,1", /^zoom: /],
    ["south above north", "?bbox=0,10,1,0&zoom=3", /^bbox: /],
    ["three bbox values", "?bbox=0,0,1&zoom=3", /^bbox/],
    ["a non-numeric bbox", "?bbox=a,b,c,d&zoom=3", /^bbox/],
    ["zoom above 22", "?bbox=0,0,1,1&zoom=23", /^zoom: /],
    ["a fractional zoom", "?bbox=0,0,1,1&zoom=2.5", /^zoom: /],
    ["an empty zoom", "?bbox=0,0,1,1&zoom=", /^zoom: /],
    ["an empty bbox", "?bbox=&zoom=3", /^bbox/],
    ["a bad first value of a repeated key", "?bbox=0,0,1,1&zoom=x&zoom=3", /^zoom: /],
  ])("rejects %s with 400", async (_label, query, message) => {
    expect(await expectError(await getRooms(query), 400, "validation_error")).toMatch(message);
  });
});
