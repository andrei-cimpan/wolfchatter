import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Message, Room } from "@/lib/types";
import { messagePostLimiter } from "@/server/http/rate-limit";
import { getChatRepository } from "@/server/repositories";
import { getPool } from "@/server/repositories/db";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET, POST } from "./route";

setupTestDatabase();
// The routes use the app's shared pool; leaving it open keeps the test worker alive.
afterAll(() => getPool().end());
// The limiter is module state shared by every test in this file.
beforeEach(() => messagePostLimiter.reset());

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getMessages(roomId: string, query = ""): Promise<Response> {
  return GET(new Request(`http://test/api/rooms/${roomId}/messages${query}`), context(roomId));
}

function postMessage(roomId: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`http://test/api/rooms/${roomId}/messages`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
  return POST(request, context(roomId));
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

  // Existence is a database question, so it is asked only once the body is valid.
  it("answers an invalid body for an unknown room with 400", async () => {
    await expectError(await postMessage(UNKNOWN_ID, "{}"), 400, "validation_error");
  });

  it.each([
    ["no Content-Type", { "content-type": "" }],
    ["text/plain, as a cross-site form sends", { "content-type": "text/plain" }],
  ])("rejects %s with 415 before writing", async (_label, headers) => {
    const room = await createRoom();
    const response = await postMessage(room.id, JSON.stringify({ author: "ana", body: "hi" }), headers);
    await expectError(response, 415, "unsupported_media_type");
    expect((await getChatRepository().getRoom(room.id))?.messageCount).toBe(0);
  });

  describe("rate limiting", () => {
    const LIMIT = 30;
    const send = (roomId: string, ip: string) =>
      postMessage(roomId, JSON.stringify({ author: "ana", body: "hi" }), { "x-forwarded-for": ip });

    it("answers the post after the per-IP budget with 429 and Retry-After", async () => {
      const room = await createRoom();
      for (let i = 0; i < LIMIT; i++) expect((await send(room.id, "203.0.113.7")).status).toBe(201);

      const response = await send(room.id, "203.0.113.7");
      await expectError(response, 429, "rate_limited");
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect((await getChatRepository().getRoom(room.id))?.messageCount).toBe(LIMIT);
    });

    it("keeps each IP's budget separate", async () => {
      const room = await createRoom();
      for (let i = 0; i < LIMIT; i++) await send(room.id, "203.0.113.7");
      expect((await send(room.id, "203.0.113.8")).status).toBe(201);
    });

    it("counts invalid requests, and limits before checking the room", async () => {
      for (let i = 0; i < LIMIT; i++) await postMessage("not-a-uuid", "{}", { "x-forwarded-for": "203.0.113.7" });
      await expectError(await send("not-a-uuid", "203.0.113.7"), 429, "rate_limited");
    });
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

  // Literal numbers, not the constants: this pins the documented API, so changing a constant
  // should fail here rather than silently change what clients get.
  it("returns 50 messages without a limit and 100 with limit=100", async () => {
    const room = await createRoom();
    const repository = getChatRepository();
    for (let i = 1; i <= 101; i++) {
      await repository.postMessage(room.id, { author: "ana", body: `m${i}` });
    }

    const latest = await bodies(await getMessages(room.id));
    expect(latest).toHaveLength(50);
    expect(latest.at(-1)).toBe("m101");
    expect(await bodies(await getMessages(room.id, "?limit=100"))).toHaveLength(100);
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

  it("answers an invalid query for an unknown room with 400", async () => {
    await expectError(await getMessages(UNKNOWN_ID, "?limit=0"), 400, "validation_error");
  });
});
