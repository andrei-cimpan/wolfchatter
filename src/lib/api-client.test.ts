import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createRoom, getRoom, listMapItems } from "./api-client";
import type { Room } from "./types";

const ROOM: Room = {
  id: "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a",
  title: "Chatroom 1",
  lat: 48,
  lng: 20,
  messageCount: 0,
  createdAt: "2026-10-31T12:00:00.000Z",
};

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRoom", () => {
  it("posts JSON and returns the created room", async () => {
    const fetchMock = stubFetch(Response.json(ROOM, { status: 201 }));
    await expect(createRoom({ lat: 48, lng: 20 })).resolves.toEqual(ROOM);
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 48, lng: 20 }),
    });
  });

  it("turns a 429 into an ApiError with the Retry-After seconds", async () => {
    stubFetch(errorResponse(429, "rate_limited", "Too many requests", { "Retry-After": "42" }));
    const error = await createRoom({ lat: 0, lng: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 42 });
  });

  it("keeps the API's message for a validation error", async () => {
    stubFetch(errorResponse(400, "validation_error", "lat: Too big"));
    await expect(createRoom({ lat: 91, lng: 0 })).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
      message: "lat: Too big",
      retryAfterSeconds: undefined,
    });
  });

  it("copes with an error response that is not JSON", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(createRoom({ lat: 0, lng: 0 })).rejects.toMatchObject({
      status: 502,
      code: "http_error",
      message: "Request failed with status 502",
    });
  });

  it("ignores a Retry-After that is not a positive whole number of seconds", async () => {
    stubFetch(errorResponse(429, "rate_limited", "Slow down", { "Retry-After": "soon" }));
    await expect(createRoom({ lat: 0, lng: 0 })).rejects.toMatchObject({ retryAfterSeconds: undefined });
  });
});

describe("getRoom", () => {
  it("returns the room", async () => {
    const fetchMock = stubFetch(Response.json(ROOM));
    await expect(getRoom(ROOM.id)).resolves.toEqual(ROOM);
    expect(fetchMock).toHaveBeenCalledWith(`/api/rooms/${ROOM.id}`, undefined);
  });

  it("returns null for an unknown room", async () => {
    stubFetch(errorResponse(404, "room_not_found", "Room not found"));
    await expect(getRoom(ROOM.id)).resolves.toBeNull();
  });

  it("throws other errors", async () => {
    stubFetch(errorResponse(500, "internal_error", "Something went wrong"));
    await expect(getRoom(ROOM.id)).rejects.toMatchObject({ status: 500 });
  });
});

describe("listMapItems", () => {
  it("asks for the viewport's rooms and clusters", async () => {
    const items = [{ type: "cluster", lat: 47, lng: 19, count: 3 }];
    const fetchMock = stubFetch(Response.json(items));
    await expect(listMapItems({ bbox: { west: 170, south: -22.5, east: 191.25, north: 45 }, zoom: 5 })).resolves.toEqual(
      items,
    );
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/rooms");
    expect(url.searchParams.get("bbox")).toBe("170,-22.5,191.25,45");
    expect(url.searchParams.get("zoom")).toBe("5");
  });

  it("throws API errors", async () => {
    stubFetch(errorResponse(400, "validation_error", "bbox: Invalid"));
    await expect(listMapItems({ bbox: { west: 0, south: 0, east: 1, north: 1 }, zoom: 5 })).rejects.toMatchObject({
      status: 400,
    });
  });
});
