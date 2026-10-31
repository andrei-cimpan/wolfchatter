import { describe, expect, it } from "vitest";
import type { Bbox, MapItem } from "@/lib/types";
import { MESSAGE_LIMIT_MAX } from "@/lib/limits";
import { RoomNotFoundError } from "./chat-repository";
import { PostgresChatRepository } from "./postgres-chat-repository";
import { setupTestDatabase } from "./test/test-db";

const db = setupTestDatabase();
const repo = () => new PostgresChatRepository(db());

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const WORLD: Bbox = { west: -180, south: -90, east: 180, north: 90 };

async function postMany(roomId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push((await repo().postMessage(roomId, { author: "ana", body: `m${i}` })).id);
  return ids;
}

function bodies(messages: { body: string }[]): string[] {
  return messages.map((m) => m.body);
}

function byType(items: MapItem[]) {
  return {
    rooms: items.filter((i) => i.type === "room"),
    clusters: items.filter((i) => i.type === "cluster"),
  };
}

describe("rooms", () => {
  it("creates a room and reads it back", async () => {
    const created = await repo().createRoom({ lat: 44.43, lng: 26.1 });
    expect(created).toMatchObject({ title: "Chatroom 1", lat: 44.43, lng: 26.1, messageCount: 0 });
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    expect(await repo().getRoom(created.id)).toEqual(created);
  });

  it("returns null for an unknown or malformed id", async () => {
    expect(await repo().getRoom(UNKNOWN_ID)).toBeNull();
    expect(await repo().getRoom("not-a-uuid")).toBeNull();
  });
});

describe("postMessage", () => {
  it("stores the message and bumps the room's message count", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    const message = await repo().postMessage(room.id, { author: "ana", body: "hello" });
    expect(message).toMatchObject({ roomId: room.id, author: "ana", body: "hello" });
    expect((await repo().getRoom(room.id))?.messageCount).toBe(1);
  });

  it.each([UNKNOWN_ID, "not-a-uuid"])("throws RoomNotFoundError for room %s", async (roomId) => {
    await expect(repo().postMessage(roomId, { author: "ana", body: "hi" })).rejects.toBeInstanceOf(
      RoomNotFoundError,
    );
  });
});

describe("listMessages", () => {
  it("returns the latest page, oldest first", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    await postMany(room.id, 5);
    expect(bodies(await repo().listMessages(room.id, { limit: 3 }))).toEqual(["m3", "m4", "m5"]);
  });

  it("walks back with before until the start, without gaps or duplicates", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    await postMany(room.id, 7);
    const seen: string[] = [];
    let page = await repo().listMessages(room.id, { limit: 3 });
    while (page.length > 0) {
      seen.unshift(...bodies(page));
      page = await repo().listMessages(room.id, { limit: 3, before: page[0]!.id });
    }
    expect(seen).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  });

  it("returns only newer messages with after", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    const ids = await postMany(room.id, 4);
    expect(bodies(await repo().listMessages(room.id, { after: ids[1] }))).toEqual(["m3", "m4"]);
    expect(await repo().listMessages(room.id, { after: ids[3] })).toEqual([]);
  });

  it("pages correctly when messages share a created_at", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    // now() is fixed for a transaction, so these four rows get identical timestamps.
    await db().query(
      `insert into messages (room_id, author, body)
       select $1, 'ana', 'tie' || i from generate_series(1, 4) i`,
      [room.id],
    );
    const all = await repo().listMessages(room.id);
    expect(new Set(all.map((m) => m.createdAt)).size).toBe(1);

    const newest = await repo().listMessages(room.id, { limit: 2 });
    const older = await repo().listMessages(room.id, { limit: 2, before: newest[0]!.id });
    expect([...older, ...newest].map((m) => m.id)).toEqual(all.map((m) => m.id));
    expect((await repo().listMessages(room.id, { after: all[1]!.id })).map((m) => m.id)).toEqual(
      all.slice(2).map((m) => m.id),
    );
  });

  it("only returns messages from the requested room", async () => {
    const a = await repo().createRoom({ lat: 0, lng: 0 });
    const b = await repo().createRoom({ lat: 1, lng: 1 });
    await repo().postMessage(a.id, { author: "ana", body: "in a" });
    const inB = await repo().postMessage(b.id, { author: "ana", body: "in b" });
    expect(bodies(await repo().listMessages(a.id))).toEqual(["in a"]);
    // A cursor from another room matches nothing rather than leaking that room's position.
    expect(await repo().listMessages(a.id, { before: inB.id })).toEqual([]);
  });

  it("caps the limit", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    await db().query(
      `insert into messages (room_id, author, body) select $1, 'ana', 'x' from generate_series(1, $2::int)`,
      [room.id, MESSAGE_LIMIT_MAX + 10],
    );
    // Literal, not MESSAGE_LIMIT_MAX, so changing the constant is a visible test change.
    expect(await repo().listMessages(room.id, { limit: 10_000 })).toHaveLength(100);
    expect(await repo().listMessages(room.id, { limit: 0 })).toHaveLength(1);
  });

  it("returns 50 messages by default, and when the limit is not a number", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    await db().query(
      `insert into messages (room_id, author, body) select $1, 'ana', 'x' from generate_series(1, 60)`,
      [room.id],
    );
    expect(await repo().listMessages(room.id)).toHaveLength(50);
    expect(await repo().listMessages(room.id, { limit: Number.NaN })).toHaveLength(50);
  });

  it("applies the limit to after, starting from the oldest newer message", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    const ids = await postMany(room.id, 5);
    expect(bodies(await repo().listMessages(room.id, { after: ids[0], limit: 2 }))).toEqual(["m2", "m3"]);
  });

  it("returns nothing for an unknown room or malformed ids", async () => {
    expect(await repo().listMessages(UNKNOWN_ID)).toEqual([]);
    expect(await repo().listMessages("not-a-uuid")).toEqual([]);
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    expect(await repo().listMessages(room.id, { before: "not-a-uuid" })).toEqual([]);
  });

  it("rejects before and after together", async () => {
    await expect(repo().listMessages(UNKNOWN_ID, { before: UNKNOWN_ID, after: UNKNOWN_ID })).rejects.toThrow(
      /not both/,
    );
  });
});

describe("listMapItems", () => {
  // Two rooms in Bucharest, about 11 km apart, and one in Paris.
  async function seedCities() {
    const bucharest1 = await repo().createRoom({ lat: 44.4, lng: 26.1 });
    const bucharest2 = await repo().createRoom({ lat: 44.5, lng: 26.2 });
    const paris = await repo().createRoom({ lat: 48.8, lng: 2.3 });
    return { bucharest1, bucharest2, paris };
  }

  it("clusters nearby rooms at low zoom and keeps distant ones as rooms", async () => {
    const { paris } = await seedCities();
    const { rooms, clusters } = byType(await repo().listMapItems({ bbox: WORLD, zoom: 2 }));

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ count: 2 });
    expect(clusters[0]!.lat).toBeCloseTo(44.45, 10);
    expect(clusters[0]!.lng).toBeCloseTo(26.15, 10);
    expect(rooms).toEqual([
      { type: "room", id: paris.id, title: paris.title, lat: 48.8, lng: 2.3, messageCount: 0 },
    ]);
  });

  it("splits a cluster at a higher zoom", async () => {
    await seedCities();
    const { rooms, clusters } = byType(await repo().listMapItems({ bbox: WORLD, zoom: 10 }));
    expect(clusters).toEqual([]);
    expect(rooms).toHaveLength(3);
  });

  it("never clusters at zoom 16 and above", async () => {
    await repo().createRoom({ lat: 44.4, lng: 26.1 });
    await repo().createRoom({ lat: 44.4, lng: 26.1 });
    const items = await repo().listMapItems({
      bbox: { west: 26.09, south: 44.39, east: 26.11, north: 44.41 },
      zoom: 16,
    });
    expect(items.map((i) => i.type)).toEqual(["room", "room"]);
  });

  it("still clusters at zoom 15", async () => {
    await repo().createRoom({ lat: 44.4, lng: 26.1 });
    await repo().createRoom({ lat: 44.4, lng: 26.1 });
    expect(await repo().listMapItems({ bbox: WORLD, zoom: 15 })).toEqual([
      { type: "cluster", lat: 44.4, lng: 26.1, count: 2 },
    ]);
  });

  it("includes the message count on room items", async () => {
    const room = await repo().createRoom({ lat: 10, lng: 10 });
    await postMany(room.id, 2);
    expect(await repo().listMapItems({ bbox: WORLD, zoom: 3 })).toEqual([
      expect.objectContaining({ type: "room", id: room.id, messageCount: 2 }),
    ]);
  });

  it("excludes rooms outside the viewport", async () => {
    const { bucharest1, bucharest2 } = await seedCities();
    // Inside the longitude range, north of the viewport: only the latitude filter excludes it.
    await repo().createRoom({ lat: 50, lng: 25 });
    const items = await repo().listMapItems({ bbox: { west: 20, south: 40, east: 30, north: 46 }, zoom: 16 });
    expect(items.map((i) => (i.type === "room" ? i.id : null)).sort()).toEqual(
      [bucharest1.id, bucharest2.id].sort(),
    );
  });

  it.each([3, 16])("handles a viewport across the antimeridian at zoom %d", async (zoom) => {
    const east = await repo().createRoom({ lat: 0, lng: 179.5 });
    const west = await repo().createRoom({ lat: 0, lng: -179.5 });
    await repo().createRoom({ lat: 0, lng: 0 });
    await repo().createRoom({ lat: 0, lng: 160 });

    const items = await repo().listMapItems({ bbox: { west: 170, south: -10, east: -170, north: 10 }, zoom });

    // Both sides come back, as separate rooms: grid cells never span ±180.
    expect(items.map((i) => (i.type === "room" ? i.id : "cluster")).sort()).toEqual([east.id, west.id].sort());
  });

  it.each([
    [16, 0.000_01],
    [10, 0.1],
  ])("returns at most 500 items at zoom %d", async (zoom, spacing) => {
    await db().query(
      "insert into rooms (lat, lng) select 10 + i * $1::float8, 20 from generate_series(1, 600) i",
      [spacing],
    );
    const items = await repo().listMapItems({ bbox: { west: 19, south: 9, east: 21, north: 80 }, zoom });
    expect(items).toHaveLength(500);
  });

  it("keeps the newest rooms when capping at zoom 16", async () => {
    // r1 is the newest and r501 the oldest.
    await db().query(
      `insert into rooms (title, lat, lng, created_at)
       select 'r' || i, 10 + i * 0.00001, 20, now() - i * interval '1 second' from generate_series(1, 501) i`,
    );
    const titles = (await repo().listMapItems({ bbox: { west: 19, south: 9, east: 21, north: 11 }, zoom: 16 })).map(
      (i) => (i.type === "room" ? i.title : "cluster"),
    );
    expect(titles).toHaveLength(500);
    expect(titles[0]).toBe("r1");
    expect(titles).not.toContain("r501");
  });

  it("keeps the busiest cells when capping clustered results", async () => {
    // 500 single-room cells plus one cell holding three rooms: 501 cells for 500 slots.
    await db().query(
      "insert into rooms (lat, lng) select 10 + i * 0.1, 20 from generate_series(1, 500) i",
    );
    await db().query("insert into rooms (lat, lng) select 5, 25 from generate_series(1, 3)");
    const items = await repo().listMapItems({ bbox: { west: 19, south: 4, east: 26, north: 80 }, zoom: 10 });
    expect(items).toHaveLength(500);
    expect(items[0]).toEqual({ type: "cluster", lat: 5, lng: 25, count: 3 });
  });

  it("among equally busy cells, keeps those nearest the viewport's centre", async () => {
    // 501 single-room cells from 10.1°N to 60.1°N; the centre is at 50°N, so 10.1°N is the farthest.
    await db().query(
      "insert into rooms (lat, lng) select 10 + i * 0.1, 20 from generate_series(1, 501) i",
    );
    const items = await repo().listMapItems({ bbox: { west: 19, south: 10, east: 21, north: 90 }, zoom: 10 });
    const lats = items.map((i) => Math.round(i.lat * 10) / 10);
    expect(lats).toHaveLength(500);
    expect(lats).toContain(60.1);
    expect(lats).not.toContain(10.1);
  });
});
