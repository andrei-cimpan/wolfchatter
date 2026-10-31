import pg from "pg";
import { describe, expect, it } from "vitest";
import { setupTestDatabase } from "./test/test-db";

const db = setupTestDatabase();

async function createRoom(lat = 44.43, lng = 26.1): Promise<{ id: string; title: string }> {
  const { rows } = await db().query<{ id: string; title: string }>(
    "insert into rooms (lat, lng) values ($1, $2) returning id, title",
    [lat, lng],
  );
  return rows[0]!;
}

describe("initial schema", () => {
  it("creates the tables and indexes", async () => {
    const tables = await db().query<{ name: string }>(
      "select to_regclass(n)::text as name from unnest($1::text[]) as n",
      [["rooms", "messages", "messages_room_created_idx", "rooms_location_idx"]],
    );
    expect(tables.rows.map((r) => r.name)).toEqual([
      "rooms",
      "messages",
      "messages_room_created_idx",
      "rooms_location_idx",
    ]);
  });

  it("titles rooms 'Chatroom N' with an increasing number", async () => {
    const first = await createRoom();
    const second = await createRoom();
    const number = (title: string) => Number(/^Chatroom (\d+)$/.exec(title)?.[1]);
    expect(number(second.title)).toBeGreaterThan(number(first.title));
  });

  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
  ])("rejects a room at lat %d, lng %d", async (lat, lng) => {
    await expect(createRoom(lat, lng)).rejects.toThrow(/check constraint/);
  });

  it.each([
    ["", "hi"],
    ["a".repeat(33), "hi"],
    ["ana", ""],
    ["ana", "b".repeat(1001)],
  ])("rejects an out-of-range author or body (case %#)", async (author, body) => {
    const room = await createRoom();
    await expect(
      db().query("insert into messages (room_id, author, body) values ($1, $2, $3)", [room.id, author, body]),
    ).rejects.toThrow(/check constraint/);
  });

  it("counts messages on the room and notifies listeners on insert", async () => {
    const room = await createRoom();
    const listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
    try {
      await listener.query("listen messages");
      const notified = new Promise<pg.Notification>((resolve) => listener.once("notification", resolve));

      await db().query("insert into messages (room_id, author, body) values ($1, 'ana', 'hello')", [room.id]);

      const payload: unknown = JSON.parse((await notified).payload ?? "null");
      expect(payload).toMatchObject({ room_id: room.id, author: "ana", body: "hello" });
      const { rows } = await db().query<{ message_count: number }>(
        "select message_count from rooms where id = $1",
        [room.id],
      );
      expect(rows[0]?.message_count).toBe(1);
    } finally {
      await listener.end();
    }
  });
});
