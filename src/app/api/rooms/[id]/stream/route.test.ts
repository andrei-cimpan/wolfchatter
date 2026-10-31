import { afterAll, describe, expect, it } from "vitest";
import type { Message } from "@/lib/types";
import { stopRealtimeHub } from "@/server/realtime";
import { getChatRepository } from "@/server/repositories";
import { getPool } from "@/server/repositories/db";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET } from "./route";

setupTestDatabase();
// The hub holds a LISTEN connection and the route uses the shared pool; both keep the worker alive.
afterAll(async () => {
  await stopRealtimeHub();
  await getPool().end();
});

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

function openStream(roomId: string, signal?: AbortSignal): Promise<Response> {
  return GET(new Request(`http://test/api/rooms/${roomId}/stream`, { signal }), {
    params: Promise.resolve({ id: roomId }),
  });
}

// Reads the stream until its text so far contains `expected`.
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(expected)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Stream ended before "${expected}"; got: ${text}`);
    text += decoder.decode(value);
  }
  return text;
}

describe("GET /api/rooms/:id/stream", () => {
  it("answers 404 for a malformed or unknown room", async () => {
    for (const id of ["not-a-uuid", UNKNOWN_ID]) {
      const response = await openStream(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "room_not_found", message: expect.any(String) } });
    }
  });

  it("streams a message posted after ready, and only for its own room", async () => {
    const repository = getChatRepository();
    const [room, other] = await Promise.all([
      repository.createRoom({ lat: 44.43, lng: 26.1 }),
      repository.createRoom({ lat: 45.75, lng: 21.23 }),
    ]);
    const controller = new AbortController();
    const response = await openStream(room.id, controller.signal);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");

    const reader = response.body!.getReader();
    await readUntil(reader, "event: ready");
    await repository.postMessage(other.id, { author: "bob", body: "elsewhere" });
    const posted: Message = await repository.postMessage(room.id, { author: "ana", body: "hello" });

    const text = await readUntil(reader, "event: message");
    expect(text).toBe(`event: message\ndata: ${JSON.stringify(posted)}\n\n`);
    controller.abort();
  });
});
