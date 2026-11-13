import { describe, expect, it } from "vitest";
import { getChatRepository } from "@/server/repositories";
import { sessionCookieHeader } from "@/server/repositories/test/session-cookies";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { createTestUser } from "@/server/repositories/test/test-users";
import { DELETE, GET } from "./route";

setupTestDatabase();

function getRoom(id: string): Promise<Response> {
  return GET(new Request(`http://test/api/rooms/${id}`), { params: Promise.resolve({ id }) });
}

describe("GET /api/rooms/:id", () => {
  it("returns the room", async () => {
    const { session } = await createTestUser();
    const signedIn = new Request("http://test/", { headers: { cookie: await sessionCookieHeader(session) } });
    const room = await getChatRepository(signedIn).createRoom({ lat: 44.43, lng: 26.1 });
    // Read signed out: rooms are public.
    const response = await getRoom(room.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...room, canDelete: false });
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

describe("DELETE /api/rooms/:id", () => {
  async function signedInAs(name: string) {
    const { session } = await createTestUser({ full_name: name });
    return { cookie: await sessionCookieHeader(session) };
  }

  function deleteRoom(id: string, headers: Record<string, string> = {}): Promise<Response> {
    return DELETE(new Request(`http://test/api/rooms/${id}`, { method: "DELETE", headers }), {
      params: Promise.resolve({ id }),
    });
  }

  async function roomBy(headers: Record<string, string>) {
    return getChatRepository(new Request("http://test/", { headers })).createRoom({ lat: 44.43, lng: 26.1 });
  }

  it("deletes the creator's room with 204, after which it is not found", async () => {
    const owner = await signedInAs("Ana Popescu");
    const room = await roomBy(owner);
    const response = await deleteRoom(room.id, owner);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect((await getRoom(room.id)).status).toBe(404);
  });

  it("answers another user with 403 forbidden and keeps the room", async () => {
    const room = await roomBy(await signedInAs("Ana Popescu"));
    const response = await deleteRoom(room.id, await signedInAs("Ion Ionescu"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Only the room's creator can delete it" },
    });
    expect((await getRoom(room.id)).status).toBe(200);
  });

  it("answers a signed-out caller with 401", async () => {
    const room = await roomBy(await signedInAs("Ana Popescu"));
    const response = await deleteRoom(room.id);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
  });

  it.each(["00000000-0000-4000-8000-000000000000", "not-a-uuid"])("answers %s with 404", async (id) => {
    const response = await deleteRoom(id, await signedInAs("Ana Popescu"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "room_not_found", message: "Room not found" } });
  });
});
