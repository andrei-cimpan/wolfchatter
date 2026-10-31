import { afterAll, describe, expect, it } from "vitest";
import type { Message, Room } from "@/lib/types";
import { getChatRepository } from "@/server/repositories";
import { getPool } from "@/server/repositories/db";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET, POST } from "./route";

setupTestDatabase();
// The routes use the app's shared pool; leaving it open keeps the test worker alive.
afterAll(() => getPool().end());

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getMessages(roomId: string, query = ""): Promise<Response> {
  return GET(new Request(`http://test/api/rooms/${roomId}/messages${query}`), context(roomId));
}

function postMessage(roomId: string, body: string): Promise<Response> {
  return POST(new Request(`http://test/api/rooms/${roomId}/messages`, { method: "POST", body }), context(roomId));
}

function createRoom(): Promise<Room> {
  return getChatRepository().createRoom({ lat: 44.43, lng: 26.1 });
}

async function post(roomId: string, body: string): Promise<Message> {
  return (await postMessage(roomId, JSON.stringify({ author: "ana", body }))).json();
}

async function bodies(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  return ((await response.json()) as Message[]).map((m) => m.body);
}

async function expectError(response: Response, status: number, code: string): Promise<string> {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  return body.error.message;
}

describe("POST /api/rooms/:id/messages", () => {
  it("creates a trimmed message and counts it on the room", async () => {
    const room = await createRoom();
    const response = await postMessage(room.id, JSON.stringify({ author: " ana ", body: " hello\nthere " }));
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({
      id: expect.any(String),
      roomId: room.id,
      author: "ana",
      body: "hello\nthere",
      createdAt: expect.any(String),
    });
    expect((await getChatRepository().getRoom(room.id))?.messageCount).toBe(1);
  });

  it.each([
    ["a missing author", { body: "hi" }, /^author: /],
    ["an empty body", { author: "ana", body: "" }, /^body: /],
    ["a body of zero-width spaces", { author: "ana", body: "\u200B\u200B" }, /^body: Message is required$/],
    ["an author over 32 characters", { author: "a".repeat(33), body: "hi" }, /^author: /],
    ["a body over 1000 characters", { author: "ana", body: "a".repeat(1001) }, /^body: /],
    ["a non-string body", { author: "ana", body: 5 }, /^body: /],
    ["an array body", ["ana", "hi"], /./],
  ])("rejects %s with 400", async (_label, body, message) => {
    const room = await createRoom();
    expect(await expectError(await postMessage(room.id, JSON.stringify(body)), 400, "validation_error")).toMatch(
      message,
    );
    expect((await getChatRepository().getRoom(room.id))?.messageCount).toBe(0);
  });

  it("rejects a non-JSON body with 400", async () => {
    const room = await createRoom();
    await expectError(await postMessage(room.id, "author=ana&body=hi"), 400, "invalid_json");
  });

  it("rejects an oversized body with 413", async () => {
    const room = await createRoom();
    const body = JSON.stringify({ author: "ana", body: "hi", pad: "x".repeat(20_000) });
    await expectError(await postMessage(room.id, body), 413, "payload_too_large");
  });

  it.each([UNKNOWN_ID, "not-a-uuid"])("answers room %s with 404 room_not_found", async (id) => {
    const response = await postMessage(id, JSON.stringify({ author: "ana", body: "hi" }));
    expect(await expectError(response, 404, "room_not_found")).toBe("Room not found");
  });

  it("answers a malformed room id with 404 before reading the body", async () => {
    await expectError(await postMessage("not-a-uuid", "not json"), 404, "room_not_found");
  });
});

describe("GET /api/rooms/:id/messages", () => {
  it("returns [] for a room with no messages", async () => {
    const room = await createRoom();
    expect(await bodies(await getMessages(room.id))).toEqual([]);
  });

  it("returns the latest page, oldest first", async () => {
    const room = await createRoom();
    for (const body of ["one", "two", "three"]) await post(room.id, body);
    expect(await bodies(await getMessages(room.id))).toEqual(["one", "two", "three"]);
    expect(await bodies(await getMessages(room.id, "?limit=2"))).toEqual(["two", "three"]);
  });

  it("pages with before and after", async () => {
    const room = await createRoom();
    const one = await post(room.id, "one");
    const two = await post(room.id, "two");
    const three = await post(room.id, "three");
    expect(await bodies(await getMessages(room.id, `?before=${three.id}`))).toEqual(["one", "two"]);
    expect(await bodies(await getMessages(room.id, `?before=${three.id}&limit=1`))).toEqual(["two"]);
    expect(await bodies(await getMessages(room.id, `?after=${one.id}`))).toEqual(["two", "three"]);
    expect(await bodies(await getMessages(room.id, `?after=${two.id}&limit=5`))).toEqual(["three"]);
  });

  it("only returns messages of the requested room", async () => {
    const room = await createRoom();
    const other = await createRoom();
    await post(room.id, "here");
    await post(other.id, "elsewhere");
    expect(await bodies(await getMessages(room.id))).toEqual(["here"]);
  });

  // Cursors are ids the server issued, so one that matches nothing in this room comes from a
  // broken client; the repository's empty page is passed through rather than checked separately.
  it("returns [] for a cursor from another room", async () => {
    const room = await createRoom();
    const other = await createRoom();
    await post(room.id, "here");
    const foreign = await post(other.id, "elsewhere");
    expect(await bodies(await getMessages(room.id, `?after=${foreign.id}`))).toEqual([]);
    expect(await bodies(await getMessages(room.id, `?before=${UNKNOWN_ID}`))).toEqual([]);
  });

  it.each([
    ["a malformed before", "?before=abc", /^before: /],
    ["a malformed after", "?after=1", /^after: /],
    ["both cursors", `?before=${UNKNOWN_ID}&after=${UNKNOWN_ID}`, /^after: Use before or after, not both$/],
    ["limit 0", "?limit=0", /^limit: /],
    ["limit above 100", "?limit=101", /^limit: /],
    ["a fractional limit", "?limit=1.5", /^limit: /],
    ["an empty limit", "?limit=", /^limit: /],
    ["an empty cursor", "?before=", /^before: /],
  ])("rejects %s with 400", async (_label, query, message) => {
    const room = await createRoom();
    expect(await expectError(await getMessages(room.id, query), 400, "validation_error")).toMatch(message);
  });

  it.each([UNKNOWN_ID, "not-a-uuid", "%00"])("answers room %s with 404 room_not_found", async (id) => {
    expect(await expectError(await getMessages(id), 404, "room_not_found")).toBe("Room not found");
  });
});
