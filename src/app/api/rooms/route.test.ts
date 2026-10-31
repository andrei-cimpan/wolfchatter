import { afterAll, describe, expect, it } from "vitest";
import type { MapItem, Room } from "@/lib/types";
import { getPool } from "@/server/repositories/db";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET, POST } from "./route";

setupTestDatabase();
// The routes use the app's shared pool; leaving it open keeps the test worker alive.
afterAll(() => getPool().end());

function getRooms(query: string): Promise<Response> {
  return GET(new Request(`http://test/api/rooms${query}`));
}

function postRoom(body: string): Promise<Response> {
  return POST(new Request("http://test/api/rooms", { method: "POST", body }));
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

  it("wraps a longitude from a repeated copy of the world", async () => {
    const room = await createRoom(10, 200);
    expect(room.lng).toBe(-160);
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

  it.each(["", "{lat: 1}", "lat=1&lng=2"])("rejects the non-JSON body %j with 400", async (body) => {
    await expectError(await postRoom(body), 400, "invalid_json");
  });
});

describe("GET /api/rooms", () => {
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
