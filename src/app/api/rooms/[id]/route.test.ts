import { afterAll, describe, expect, it } from "vitest";
import { getChatRepository } from "@/server/repositories";
import { getPool } from "@/server/repositories/db";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET } from "./route";

setupTestDatabase();
// The route uses the app's shared pool; leaving it open keeps the test worker alive.
afterAll(() => getPool().end());

function getRoom(id: string): Promise<Response> {
  return GET(new Request(`http://test/api/rooms/${id}`), { params: Promise.resolve({ id }) });
}

describe("GET /api/rooms/:id", () => {
  it("returns the room", async () => {
    const room = await getChatRepository().createRoom({ lat: 44.43, lng: 26.1 });
    const response = await getRoom(room.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(room);
  });

  it.each(["00000000-0000-4000-8000-000000000000", "not-a-uuid", "%00"])(
    "answers %s with 404 room_not_found",
    async (id) => {
      const response = await getRoom(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "room_not_found", message: "Room not found" } });
    },
  );
});
