import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { MessageRow } from "@/lib/message-row";
import { subscribeToRoomMessages } from "@/lib/supabase/room-channel";
import { anonClient } from "./test/supabase-client";
import { setupTestDatabase } from "./test/test-db";
import { createTestUser } from "./test/test-users";

const db = setupTestDatabase();

const INSUFFICIENT_PRIVILEGE = "42501";

async function createRoom(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.from("rooms").insert({ lat: 44.4, lng: 26.1 }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function storedAuthors(roomId: string): Promise<string[]> {
  const { rows } = await db().query<{ author: string }>("select author from messages where room_id = $1", [roomId]);
  return rows.map((row) => row.author);
}

describe("signed out", () => {
  it("cannot create rooms or post", async () => {
    const anon = anonClient();
    const { userId, client } = await createTestUser();
    const roomId = await createRoom(client);

    const room = await anon.from("rooms").insert({ lat: 1, lng: 1 });
    const message = await anon.from("messages").insert({ room_id: roomId, body: "hi" });
    const both = await anon.rpc("create_room_with_message", { p_lat: 1, p_lng: 1, p_body: "hi" });

    expect(room.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(message.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(both.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const { rows } = await db().query("select 1 from rooms where created_by <> $1", [userId]);
    expect(rows).toEqual([]);
  });

  it("can read rooms and messages", async () => {
    const { client } = await createTestUser();
    const roomId = await createRoom(client);
    await client.from("messages").insert({ room_id: roomId, body: "hello" });

    const anon = anonClient();
    const rooms = await anon.from("rooms").select("id");
    const messages = await anon.from("messages").select("body");
    expect(rooms.data).toEqual([{ id: roomId }]);
    expect(messages.data).toEqual([{ body: "hello" }]);
  });

  it("still receives live messages", async () => {
    const { client } = await createTestUser();
    const roomId = await createRoom(client);
    const anon = anonClient();
    const rows: MessageRow[] = [];
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = subscribeToRoomMessages(anon, roomId, {
        onInsert: (row) => rows.push(row),
        onStatus: (status) => {
          if (status === "failed") return reject(new Error("channel failed"));
          const posted = async () => {
            await client.from("messages").insert({ room_id: roomId, body: "live" });
            await expect.poll(() => rows.map((row) => row.body), { timeout: 5000 }).toEqual(["live"]);
          };
          posted().then(resolve, reject).finally(unsubscribe);
        },
      });
    });
    await anon.removeAllChannels();
  }, 20_000);
});

describe("signed in", () => {
  it("stores the user's own name as the author", async () => {
    const { client } = await createTestUser({ full_name: "Ana Popescu" });
    const roomId = await createRoom(client);
    const { data, error } = await client
      .from("messages")
      .insert({ room_id: roomId, body: "hello" })
      .select("author")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ author: "Ana P." });
  });

  it("cannot post as another user", async () => {
    const owner = await createTestUser({ full_name: "Ana Popescu" });
    const other = await createTestUser({ full_name: "Bo Ionescu" });
    const roomId = await createRoom(owner.client);

    const asOwner = await other.client.from("messages").insert({ room_id: roomId, body: "hi", user_id: owner.userId });
    const roomAsOwner = await other.client.from("rooms").insert({ lat: 1, lng: 1, created_by: owner.userId });

    expect(asOwner.error).not.toBeNull();
    expect(roomAsOwner.error).not.toBeNull();
    const { rows } = await db().query("select 1 from messages where user_id = $1", [owner.userId]);
    expect(rows).toEqual([]);
  });

  it("cannot choose the author name", async () => {
    const { client } = await createTestUser({ full_name: "Ana Popescu" });
    const roomId = await createRoom(client);

    // Refused or overwritten: either way the name is not stored.
    await client.from("messages").insert({ room_id: roomId, body: "hi", author: "Someone Else" });

    expect(await storedAuthors(roomId)).not.toContain("Someone Else");
  });

  it("keeps the identity's name after the user edits their own metadata", async () => {
    const { client } = await createTestUser({ full_name: "Ana Popescu" });
    const roomId = await createRoom(client);
    const updated = await client.auth.updateUser({ data: { full_name: "Someone Else", given_name: "Someone" } });
    expect(updated.error).toBeNull();

    const { error } = await client.from("messages").insert({ room_id: roomId, body: "after the edit" });

    expect(error).toBeNull();
    expect(await storedAuthors(roomId)).toEqual(["Ana P."]);
  });

  // The name's source must be one the user cannot edit: the API does not expose the auth schema.
  it("cannot edit their identity, where the name comes from", async () => {
    const { client, userId } = await createTestUser({ full_name: "Ana Popescu" });
    const { error } = await client
      .schema("auth")
      .from("identities")
      .update({ identity_data: { full_name: "Someone Else" } })
      .eq("user_id", userId);
    expect(error).not.toBeNull();
    const { rows } = await db().query<{ name: string }>(
      "select identity_data ->> 'full_name' as name from auth.identities where user_id = $1",
      [userId],
    );
    expect(rows).toEqual([{ name: "Ana Popescu" }]);
  });

  it.each<Record<string, unknown>>([
    { lat: 1, lng: 1, title: "Mine" },
    { lat: 1, lng: 1, message_count: 99 },
    { lat: 1, lng: 1, created_at: "2000-01-01T00:00:00Z" },
  ])("cannot set server-owned columns on a room (%j)", async (row) => {
    const { client } = await createTestUser();
    const { error } = await client.from("rooms").insert(row);
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot set created_at on a message", async () => {
    const { client } = await createTestUser();
    const roomId = await createRoom(client);
    const { error } = await client
      .from("messages")
      .insert({ room_id: roomId, body: "hi", created_at: "2000-01-01T00:00:00Z" });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot update or delete rooms or messages, even their own", async () => {
    const { client } = await createTestUser({ full_name: "Ana Popescu" });
    const roomId = await createRoom(client);
    await client.from("messages").insert({ room_id: roomId, body: "original" });

    await client.from("rooms").update({ lat: 2 }).eq("id", roomId);
    await client.from("messages").update({ body: "edited" }).eq("room_id", roomId);
    await client.from("messages").delete().eq("room_id", roomId);
    await client.from("rooms").delete().eq("id", roomId);

    const { rows: rooms } = await db().query<{ lat: number }>("select lat from rooms where id = $1", [roomId]);
    const { rows: messages } = await db().query<{ body: string }>("select body from messages where room_id = $1", [
      roomId,
    ]);
    expect(rooms).toEqual([{ lat: 44.4 }]);
    expect(messages).toEqual([{ body: "original" }]);
  });

  it("creates a room with its first message in one call", async () => {
    const { client, userId } = await createTestUser({ full_name: "Ana Popescu" });
    const { data, error } = await client.rpc("create_room_with_message", { p_lat: 1, p_lng: 2, p_body: "first" });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      room: { lat: 1, lng: 2, message_count: 1, created_by: userId },
      message: { body: "first", author: "Ana P.", user_id: userId },
    });
  });
});
