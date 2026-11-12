import { PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { MESSAGE_LIMIT_DEFAULT, MESSAGE_LIMIT_MAX } from "@/lib/limits";
import { CLUSTER_MAX_ZOOM, clusterCellSize } from "@/lib/map-grid";
import { messageFromRow, type MessageRow } from "@/lib/message-row";
import type { Bbox, MapItem, Message, Room } from "@/lib/types";
import { NotSignedInError, RoomNotFoundError, type ChatRepository, type ListMessagesOptions } from "./chat-repository";
import { MAP_ITEMS_LIMIT, longitudeRanges, viewportCenter } from "./viewport-ranges";

const FOREIGN_KEY_VIOLATION = "23503";
// Postgres's code for a write the role may not make: signed out, since signed-in users may post.
const INSUFFICIENT_PRIVILEGE = "42501";
// PostgREST's codes for a token it will not accept (expired, or not one it can verify).
const REJECTED_TOKEN = new Set(["PGRST301", "PGRST303"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres rejects malformed uuid text with an error; to callers it is just an id that matches nothing.
function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** A `rooms` row as PostgREST sends it: timestamps arrive as text. */
type RoomRow = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  message_count: number;
  created_at: string;
};

type CellRow = {
  count: number;
  lat: number;
  lng: number;
  id: string;
  title: string;
  message_count: number;
};

const ROOM_COLUMNS = "id, title, lat, lng, message_count, created_at";
const MESSAGE_COLUMNS = "id, room_id, author, body, created_at";

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    title: row.title,
    lat: row.lat,
    lng: row.lng,
    messageCount: row.message_count,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toRoomItem(row: Pick<RoomRow, "id" | "title" | "lat" | "lng" | "message_count">): MapItem {
  return {
    type: "room",
    id: row.id,
    title: row.title,
    lat: row.lat,
    lng: row.lng,
    messageCount: row.message_count,
  };
}

// NaN would reach Postgres as the text "NaN" and fail the query, so it means "use the default".
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return MESSAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.trunc(limit), 1), MESSAGE_LIMIT_MAX);
}

// The viewport filter the SQL functions share: one latitude range and two longitude ranges.
function viewportParams(bbox: Bbox) {
  const [a, b] = longitudeRanges(bbox);
  return { p_south: bbox.south, p_north: bbox.north, p_from1: a.from, p_to1: a.to, p_from2: b.from, p_to2: b.to };
}

// The client returns errors as plain objects, typed as PostgrestError but not built as one; thrown
// as they are, they carry no stack and fail `instanceof Error`.
function asError(error: PostgrestError): Error {
  if (error.code === INSUFFICIENT_PRIVILEGE || REJECTED_TOKEN.has(error.code)) return new NotSignedInError();
  return error instanceof Error ? error : new PostgrestError(error);
}

// Without generated database types the client types every result as `any`; this names the row
// type each call expects, and turns PostgREST's `{ error }` into a thrown error.
function rowsOf<T>({ data, error }: { data: unknown; error: PostgrestError | null }): T {
  if (error) throw asError(error);
  return data as T;
}

export class SupabaseChatRepository implements ChatRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async ping(): Promise<void> {
    // No retries: a health check should report a failure now, not after the client's backoff.
    const { error } = await this.client
      .from("rooms")
      .select("id", { head: true, count: "estimated" })
      .limit(1)
      .retry(false);
    if (error) throw asError(error);
  }

  async getRoom(id: string): Promise<Room | null> {
    if (!isUuid(id)) return null;
    // No retries: the room, messages and stream routes all read the room first, and the client's
    // backoff would hold each for about 7 s before its 500 when the API is down. RPC calls are
    // POSTs, which the client never retries, so this is the only other read that needs it.
    const row = rowsOf<RoomRow | null>(
      await this.client.from("rooms").select(ROOM_COLUMNS).eq("id", id).retry(false).maybeSingle(),
    );
    return row ? toRoom(row) : null;
  }

  async createRoom({ lat, lng }: { lat: number; lng: number }): Promise<Room> {
    return toRoom(rowsOf<RoomRow>(await this.client.from("rooms").insert({ lat, lng }).select(ROOM_COLUMNS).single()));
  }

  async createRoomWithMessage(
    { lat, lng }: { lat: number; lng: number },
    { body }: { body: string },
  ): Promise<{ room: Room; message: Message }> {
    // One function call is one transaction, so a refused message leaves no room behind.
    const result = rowsOf<{ room: RoomRow; message: MessageRow }>(
      await this.client.rpc("create_room_with_message", { p_lat: lat, p_lng: lng, p_body: body }),
    );
    return { room: toRoom(result.room), message: messageFromRow(result.message) };
  }

  async listMapItems({ bbox, zoom }: { bbox: Bbox; zoom: number }): Promise<MapItem[]> {
    if (zoom >= CLUSTER_MAX_ZOOM) {
      const rows = rowsOf<RoomRow[]>(
        await this.client.rpc("list_rooms_in_view", { ...viewportParams(bbox), p_limit: MAP_ITEMS_LIMIT }),
      );
      return rows.map(toRoomItem);
    }

    const center = viewportCenter(bbox);
    const rows = rowsOf<CellRow[]>(
      await this.client.rpc("list_room_cells", {
        ...viewportParams(bbox),
        p_cell: clusterCellSize(zoom),
        p_center_lat: center.lat,
        p_center_lng: center.lng,
        p_limit: MAP_ITEMS_LIMIT,
      }),
    );
    return rows.map((row) =>
      row.count === 1 ? toRoomItem(row) : { type: "cluster", lat: row.lat, lng: row.lng, count: row.count },
    );
  }

  async listMessages(roomId: string, opts: ListMessagesOptions = {}): Promise<Message[]> {
    const { before, after } = opts;
    if (before !== undefined && after !== undefined) {
      throw new Error("listMessages accepts before or after, not both.");
    }
    const cursor = before ?? after;
    if (!isUuid(roomId) || (cursor !== undefined && !isUuid(cursor))) return [];

    const rows = rowsOf<MessageRow[]>(
      await this.client.rpc("list_messages", {
        p_room_id: roomId,
        p_before: before ?? null,
        p_after: after ?? null,
        p_limit: clampLimit(opts.limit),
      }),
    );
    return rows.map(messageFromRow);
  }

  async currentAuthorName(): Promise<string | null> {
    return rowsOf<string | null>(await this.client.rpc("current_author_name"));
  }

  async postMessage(roomId: string, { body }: { body: string }): Promise<Message> {
    if (!isUuid(roomId)) throw new RoomNotFoundError(roomId);
    const { data, error } = await this.client
      .from("messages")
      .insert({ room_id: roomId, body })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error?.code === FOREIGN_KEY_VIOLATION) throw new RoomNotFoundError(roomId);
    return messageFromRow(rowsOf<MessageRow>({ data, error }));
  }
}
