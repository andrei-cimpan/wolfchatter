import type { Bbox, MapItem, Message, Room } from "./types";

/** A non-2xx API response, carrying the `{ error: { code, message } }` body when there is one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** From `Retry-After` on a 429, in seconds. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** "in 30 seconds" for a 429 with `Retry-After`, otherwise "in a minute" (the limiters' window). */
export function retryAfterPhrase(error: ApiError): string {
  const wait = error.retryAfterSeconds;
  return wait === undefined ? "in a minute" : `in ${wait} second${wait === 1 ? "" : "s"}`;
}

function isErrorBody(body: unknown): body is { error: { code: string; message: string } } {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const { error } = body;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  // A proxy or crash can answer with HTML or nothing, so the JSON error body is optional.
  const body: unknown = await response.json().catch(() => undefined);
  const retryAfter = Number(response.headers.get("Retry-After"));
  return new ApiError(
    response.status,
    isErrorBody(body) ? body.error.code : "http_error",
    isErrorBody(body) ? body.error.message : `Request failed with status ${response.status}`,
    Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export function createRoom(input: { lat: number; lng: number }): Promise<Room> {
  return request<Room>("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Resolves to `null` for an unknown room, so callers can show "not found" without a catch. */
export async function getRoom(id: string): Promise<Room | null> {
  try {
    return await request<Room>(roomPath(id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Rooms and clusters for a viewport; longitudes may be unwrapped, since the API wraps them. */
export function listMapItems({ bbox, zoom }: { bbox: Bbox; zoom: number }): Promise<MapItem[]> {
  const params = new URLSearchParams({
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north].join(","),
    zoom: String(zoom),
  });
  return request<MapItem[]>(`/api/rooms?${params}`);
}

function roomPath(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}`;
}

/** The room's latest page of messages, oldest first, or with `after` the page that follows that message. */
export function listMessages(roomId: string, options: { after?: string; limit?: number } = {}): Promise<Message[]> {
  const params = new URLSearchParams();
  if (options.after !== undefined) params.set("after", options.after);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params}` : "";
  return request<Message[]>(`${roomPath(roomId)}/messages${query}`);
}

export function postMessage(roomId: string, input: { author: string; body: string }): Promise<Message> {
  return request<Message>(`${roomPath(roomId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
