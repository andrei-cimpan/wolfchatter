import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createRoom, deleteRoom, getMe, getRoom, listMapItems, listMessages, postMessage } from "./api-client";
import type { Message, Room } from "./types";

const ROOM: Room = {
  id: "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a",
  title: "Chatroom 1",
  lat: 48,
  lng: 20,
  messageCount: 0,
  createdAt: "2026-10-31T12:00:00.000Z",
  canDelete: false,
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

const FIRST_MESSAGE = { body: "hello" };

describe("createRoom", () => {
  it("posts JSON and returns the created room", async () => {
    const fetchMock = stubFetch(Response.json(ROOM, { status: 201 }));
    await expect(createRoom({ lat: 48, lng: 20, firstMessage: FIRST_MESSAGE })).resolves.toEqual(ROOM);
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 48, lng: 20, firstMessage: FIRST_MESSAGE }),
    });
  });

  it("turns a 401 into an ApiError", async () => {
    stubFetch(errorResponse(401, "unauthenticated", "Sign in to post"));
    const error = await createRoom({ lat: 0, lng: 0, firstMessage: FIRST_MESSAGE }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("keeps the API's message for a validation error", async () => {
    stubFetch(errorResponse(400, "validation_error", "lat: Too big"));
    await expect(createRoom({ lat: 91, lng: 0, firstMessage: FIRST_MESSAGE })).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
      message: "lat: Too big",
    });
  });

  it("copes with an error response that is not JSON", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(createRoom({ lat: 0, lng: 0, firstMessage: FIRST_MESSAGE })).rejects.toMatchObject({
      status: 502,
      code: "http_error",
      message: "Request failed with status 502",
    });
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

const MESSAGE: Message = {
  id: "5d7c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
  roomId: ROOM.id,
  author: "ana",
  body: "Hello",
  createdAt: "2026-10-31T12:01:00.000Z",
};

describe("listMessages", () => {
  it("asks for the room's latest messages", async () => {
    const fetchMock = stubFetch(Response.json([MESSAGE]));
    await expect(listMessages(ROOM.id)).resolves.toEqual([MESSAGE]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/rooms/${ROOM.id}/messages`, undefined);
  });

  it("asks for the messages after one, up to a limit", async () => {
    const fetchMock = stubFetch(Response.json([MESSAGE]));
    await listMessages(ROOM.id, { after: MESSAGE.id, limit: 100 });
    expect(fetchMock).toHaveBeenCalledWith(`/api/rooms/${ROOM.id}/messages?after=${MESSAGE.id}&limit=100`, undefined);
  });

  it("throws a 404 rather than returning an empty list", async () => {
    stubFetch(errorResponse(404, "room_not_found", "Room not found"));
    await expect(listMessages(ROOM.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("postMessage", () => {
  it("posts JSON and returns the stored message", async () => {
    const fetchMock = stubFetch(Response.json(MESSAGE, { status: 201 }));
    await expect(postMessage(ROOM.id, { body: "Hello" })).resolves.toEqual(MESSAGE);
    // Only the body: the author is the signed-in user's, set by the database.
    expect(fetchMock).toHaveBeenCalledWith(`/api/rooms/${ROOM.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Hello" }),
    });
  });

  it("turns a 401 into an ApiError", async () => {
    stubFetch(errorResponse(401, "unauthenticated", "Sign in to post"));
    await expect(postMessage(ROOM.id, { body: "Hi" })).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
  });
});

describe("getMe", () => {
  it("returns the signed-in user's name, never from a cache", async () => {
    const fetchMock = stubFetch(Response.json({ name: "Ana P." }));
    await expect(getMe()).resolves.toEqual({ name: "Ana P." });
    expect(fetchMock).toHaveBeenCalledWith("/api/me", { cache: "no-store" });
  });

  it("returns null when signed out", async () => {
    stubFetch(Response.json({ name: null }));
    await expect(getMe()).resolves.toEqual({ name: null });
  });
});

describe("deleteRoom", () => {
  it("sends DELETE and resolves on 204", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await expect(deleteRoom(ROOM.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`/api/rooms/${ROOM.id}`, { method: "DELETE" });
  });

  it("turns a 403 into an ApiError", async () => {
    stubFetch(errorResponse(403, "forbidden", "Only the room's creator can delete it"));
    await expect(deleteRoom(ROOM.id)).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});
