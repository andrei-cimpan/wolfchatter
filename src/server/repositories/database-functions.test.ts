import { describe, expect, it } from "vitest";
import { setupTestDatabase } from "./test/test-db";

// The SQL functions v2's repository calls over RPC. They hold v1's queries, so these port the
// expectations of postgres-chat-repository.test.ts to the functions themselves.
const db = setupTestDatabase();

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
// One whole-world longitude range, given twice, as the repository passes a viewport that does
// not cross the antimeridian.
const WORLD = [-90, 90, -180, 180, -180, 180];

async function room(lat = 44.43, lng = 26.1): Promise<string> {
  const { rows } = await db().query<{ id: string }>("insert into rooms (lat, lng) values ($1, $2) returning id", [lat, lng]);
  return rows[0]!.id;
}

/** Posts one message per body, each in its own transaction, and returns their ids in order. */
async function post(roomId: string, ...bodies: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const body of bodies) {
    const { rows } = await db().query<{ id: string }>(
      "insert into messages (room_id, author, body) values ($1, 'ana', $2) returning id",
      [roomId, body],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

async function listMessages(roomId: string, opts: { before?: string; after?: string; limit?: number } = {}) {
  const { rows } = await db().query<{ body: string }>("select body from list_messages($1, $2, $3, $4)", [
    roomId,
    opts.before ?? null,
    opts.after ?? null,
    opts.limit ?? 50,
  ]);
  return rows.map((r) => r.body);
}

describe("list_messages", () => {
  it("returns the latest page, oldest first", async () => {
    const id = await room();
    await post(id, "m1", "m2", "m3", "m4", "m5");
    expect(await listMessages(id, { limit: 3 })).toEqual(["m3", "m4", "m5"]);
  });

  it("returns the page just older than `before`, oldest first", async () => {
    const id = await room();
    const ids = await post(id, "m1", "m2", "m3", "m4", "m5");
    expect(await listMessages(id, { before: ids[3], limit: 2 })).toEqual(["m2", "m3"]);
  });

  it("returns what follows `after`, oldest first", async () => {
    const id = await room();
    const ids = await post(id, "m1", "m2", "m3", "m4", "m5");
    expect(await listMessages(id, { after: ids[1], limit: 2 })).toEqual(["m3", "m4"]);
  });

  it("pages without gaps or repeats when messages share a created_at", async () => {
    const id = await room();
    // One statement, one transaction: every row gets the same created_at, so only id orders them.
    await db().query(
      "insert into messages (room_id, author, body) select $1, 'ana', 'm' || n from generate_series(1, 5) n",
      [id],
    );
    const { rows } = await db().query<{ id: string; body: string }>("select id, body from list_messages($1, null, null, 50)", [id]);
    const firstTwo = rows.slice(0, 2);
    const { rows: rest } = await db().query<{ body: string }>("select body from list_messages($1, null, $2, 50)", [
      id,
      firstTwo[1]!.id,
    ]);
    expect([...firstTwo.map((r) => r.body), ...rest.map((r) => r.body)]).toEqual(rows.map((r) => r.body));
    expect(new Set(rows.map((r) => r.body)).size).toBe(5);
  });

  it("returns nothing for an unknown cursor or room", async () => {
    const id = await room();
    await post(id, "m1");
    expect(await listMessages(id, { after: UNKNOWN_ID })).toEqual([]);
    expect(await listMessages(id, { before: UNKNOWN_ID })).toEqual([]);
    expect(await listMessages(UNKNOWN_ID)).toEqual([]);
  });

  it("ignores a cursor from another room", async () => {
    const id = await room();
    const other = await room();
    const [foreign] = await post(other, "x1");
    await post(id, "m1");
    expect(await listMessages(id, { after: foreign })).toEqual([]);
  });
});

describe("list_rooms_in_view", () => {
  it("returns the newest rooms in view, up to the limit", async () => {
    const older = await room(10, 10);
    const newer = await room(11, 11);
    await room(80, 170); // out of view
    const { rows } = await db().query<{ id: string }>("select id from list_rooms_in_view($1, $2, $3, $4, $5, $6, $7)", [
      0, 20, 0, 20, 0, 20, 1,
    ]);
    expect(rows.map((r) => r.id)).toEqual([newer]);
    const { rows: both } = await db().query<{ id: string }>(
      "select id from list_rooms_in_view($1, $2, $3, $4, $5, $6, $7)",
      [0, 20, 0, 20, 0, 20, 10],
    );
    expect(both.map((r) => r.id).sort()).toEqual([older, newer].sort());
  });
});

// A viewport across the antimeridian arrives as two longitude ranges: here 170 to 180 and -180 to
// -170. Task 2 deletes the v1 repository test that covered this path (review #6).
const ACROSS_ANTIMERIDIAN = [0, 20, 170, 180, -180, -170];

describe("list_rooms_in_view across the antimeridian", () => {
  it("returns rooms on both sides of the line and none outside the two ranges", async () => {
    const east = await room(10, 175);
    const west = await room(10, -175);
    await room(10, 0);
    const { rows } = await db().query<{ id: string }>("select id from list_rooms_in_view($1, $2, $3, $4, $5, $6, $7)", [
      ...ACROSS_ANTIMERIDIAN,
      10,
    ]);
    expect(rows.map((r) => r.id).sort()).toEqual([east, west].sort());
  });
});

describe("list_room_cells across the antimeridian", () => {
  const cells = async (centerLng: number) =>
    (
      await db().query<{ id: string }>("select id from list_room_cells($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
        ...ACROSS_ANTIMERIDIAN,
        2.8125,
        10,
        centerLng,
        10,
      ])
    ).rows.map((r) => r.id);

  it("returns cells on both sides of the line and none outside the two ranges", async () => {
    const east = await room(10, 175);
    const west = await room(10, -175);
    await room(10, 0);
    expect((await cells(180)).sort()).toEqual([east, west].sort());
  });

  it("measures distance to the centre the short way round", async () => {
    // From a centre at -179, 178 is 3 degrees away across the line, and -170 is 9.
    const acrossTheLine = await room(10, 178);
    const sameSide = await room(10, -170);
    expect(await cells(-179)).toEqual([acrossTheLine, sameSide]);
  });
});

describe("list_room_cells", () => {
  type Cell = { count: number; lat: number; lng: number; id: string; title: string; message_count: number };
  const cells = async (cell: number, center: [number, number], limit = 500) =>
    (
      await db().query<Cell>("select * from list_room_cells($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
        ...WORLD,
        cell,
        center[0],
        center[1],
        limit,
      ])
    ).rows;

  it("returns one row per cell, busiest first", async () => {
    await room(10.1, 10.1);
    await room(10.2, 10.2);
    await room(10.3, 10.3);
    await room(50, 50);
    const rows = await cells(11.25, [0, 0]);
    expect(rows.map((r) => r.count)).toEqual([3, 1]);
  });

  it("gives a single-room cell that room's id, title and message count", async () => {
    const id = await room(50, 50);
    await post(id, "m1", "m2");
    const [row] = await cells(11.25, [0, 0]);
    expect(row).toMatchObject({ count: 1, id, lat: 50, lng: 50, message_count: 2 });
    expect(row?.title).toMatch(/^Chatroom \d+$/);
  });

  it("among equally busy cells, puts the one nearest the centre first", async () => {
    const far = await room(40, 40);
    const near = await room(5, 5);
    const rows = await cells(11.25, [0, 0]);
    expect(rows.map((r) => r.id)).toEqual([near, far]);
    // The cap keeps the nearest.
    expect((await cells(11.25, [0, 0], 1)).map((r) => r.id)).toEqual([near]);
  });
});

describe("create_room_with_message", () => {
  it("returns the room and its first message", async () => {
    const { rows } = await db().query<{ result: { room: Record<string, unknown>; message: Record<string, unknown> } }>(
      "select create_room_with_message($1, $2, $3, $4) as result",
      [44.43, 26.1, "ana", "hello"],
    );
    const { room: created, message } = rows[0]!.result;
    expect(created).toMatchObject({ lat: 44.43, lng: 26.1, message_count: 1 });
    expect(message).toMatchObject({ room_id: created.id, author: "ana", body: "hello" });
  });

  it("leaves no room behind when the message is refused", async () => {
    await expect(
      db().query("select create_room_with_message($1, $2, $3, $4)", [44.43, 26.1, "ana", "b".repeat(1001)]),
    ).rejects.toThrow(/check constraint/);
    const { rows } = await db().query<{ n: number }>("select count(*)::int as n from rooms");
    expect(rows[0]?.n).toBe(0);
  });
});

describe("messages", () => {
  it("increments the room's message count on insert", async () => {
    const id = await room();
    await post(id, "m1", "m2");
    const { rows } = await db().query<{ message_count: number }>("select message_count from rooms where id = $1", [id]);
    expect(rows[0]?.message_count).toBe(2);
  });
});

describe("Supabase setup", () => {
  it("turns on row-level security for both tables", async () => {
    const { rows } = await db().query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('rooms', 'messages') and relnamespace = 'public'::regnamespace order by relname",
    );
    expect(rows).toEqual([
      { relname: "messages", relrowsecurity: true },
      { relname: "rooms", relrowsecurity: true },
    ]);
  });

  it("publishes messages to Realtime", async () => {
    const { rows } = await db().query(
      "select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'",
    );
    expect(rows).toHaveLength(1);
  });
});
