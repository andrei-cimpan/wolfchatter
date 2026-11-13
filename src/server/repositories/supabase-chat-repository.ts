import { PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { MESSAGE_LIMIT_DEFAULT, MESSAGE_LIMIT_MAX } from "@/lib/limits";
import { CLUSTER_MAX_ZOOM, clusterCellSize } from "@/lib/map-grid";
import { messageFromRow, type MessageRow } from "@/lib/message-row";
import type { Bbox, MapItem, Message, Room } from "@/lib/types";
import { NotRoomCreatorError, NotSignedInError, RoomNotFoundError, type ChatRepository, type ListMessagesOptions } from "./chat-repository";
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
  /** From `public.can_delete`, read only where asked for. */
  can_delete?: boolean;
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

// Rooms just created are the caller's own.
function toRoom(row: RoomRow, canDelete = row.can_delete ?? true): Room {
  return {
    id: row.id,
    title: row.title,
    lat: row.lat,
    lng: row.lng,
    messageCount: row.message_count,
    createdAt: new Date(row.created_at).toISOString(),
    canDelete,
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

type Result = { data: unknown; error: PostgrestError | null };

// The client returns errors as plain objects, typed as PostgrestError but not built as one; thrown
// as they are, they carry no stack and fail `instanceof Error`.
function asError(error: PostgrestError): Error {
  return error instanceof Error ? error : new PostgrestError(error);
}

// Without generated database types the client types every result as `any`; this names the row
// type each call expects, and turns PostgREST's `{ error }` into a thrown error.
function rowsOf<T>({ data, error }: Result): T {
  if (error) throw asError(error);
  return data as T;
}

// A write the database refused for want of a signed-in user. Only writes: on a read the same codes
// would be a grant bug or a bad token, neither of which the caller can fix by signing in.
function writtenRowsOf<T>(result: Result): T {
  const code = result.error?.code;
  if (code === INSUFFICIENT_PRIVILEGE || (code !== undefined && REJECTED_TOKEN.has(code))) throw new NotSignedInError();
  return rowsOf<T>(result);
}

export class SupabaseChatRepository implements ChatRepository {
  private readonly client: SupabaseClient;
  private readonly signedOutClient: SupabaseClient;

  /**
   * `signedOutClient` serves reads that the caller's token was rejected for (a rotated key, another
   * project's cookie), since reading needs no account.
   */
  constructor(client: SupabaseClient, signedOutClient: SupabaseClient = client) {
    this.client = client;
    this.signedOutClient = signedOutClient;
  }

  private async read(run: (client: SupabaseClient) => PromiseLike<Result>): Promise<Result> {
    const result = await run(this.client);
    const code = result.error?.code;
    if (code === undefined || !REJECTED_TOKEN.has(code) || this.signedOutClient === this.client) return result;
    return run(this.signedOutClient);
  }

  async ping(): Promise<void> {
    // No retries: a health check should report a failure now, not after the client's backoff.
    rowsOf(await this.read((c) => c.from("rooms").select("id", { head: true, count: "estimated" }).limit(1).retry(false)));
  }

  async getRoom(id: string): Promise<Room | null> {
    if (!isUuid(id)) return null;
    // No retries: the room, messages and stream routes all read the room first, and the client's
    // backoff would hold each for about 7 s before its 500 when the API is down. RPC calls are
    // POSTs, which the client never retries, so this is the only other read that needs it.
    const row = rowsOf<RoomRow | null>(
      await this.read((c) => c.from("rooms").select(`${ROOM_COLUMNS}, can_delete`).eq("id", id).retry(false).maybeSingle()),
    );
    return row ? toRoom(row, row.can_delete === true) : null;
  }

  async createRoom({ lat, lng }: { lat: number; lng: number }): Promise<Room> {
    return toRoom(
      writtenRowsOf<RoomRow>(await this.client.from("rooms").insert({ lat, lng }).select(ROOM_COLUMNS).single()),
    );
  }

  async createRoomWithMessage(
    { lat, lng }: { lat: number; lng: number },
    { body }: { body: string },
  ): Promise<{ room: Room; message: Message }> {
    // One function call is one transaction, so a refused message leaves no room behind.
    const result = writtenRowsOf<{ room: RoomRow; message: MessageRow }>(
      await this.client.rpc("create_room_with_message", { p_lat: lat, p_lng: lng, p_body: body }),
    );
    return { room: toRoom(result.room), message: messageFromRow(result.message) };
  }

  async listMapItems({ bbox, zoom }: { bbox: Bbox; zoom: number }): Promise<MapItem[]> {
    if (zoom >= CLUSTER_MAX_ZOOM) {
      const rows = rowsOf<RoomRow[]>(
        await this.read((c) => c.rpc("list_rooms_in_view", { ...viewportParams(bbox), p_limit: MAP_ITEMS_LIMIT })),
      );
      return rows.map(toRoomItem);
    }

    const center = viewportCenter(bbox);
    const rows = rowsOf<CellRow[]>(
      await this.read((c) =>
        c.rpc("list_room_cells", {
          ...viewportParams(bbox),
          p_cell: clusterCellSize(zoom),
          p_center_lat: center.lat,
          p_center_lng: center.lng,
          p_limit: MAP_ITEMS_LIMIT,
        }),
      ),
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
      await this.read((c) =>
        c.rpc("list_messages", {
          p_room_id: roomId,
          p_before: before ?? null,
          p_after: after ?? null,
          p_limit: clampLimit(opts.limit),
        }),
      ),
    );
    return rows.map(messageFromRow);
  }

  async deleteRoom(roomId: string): Promise<void> {
    if (!isUuid(roomId)) throw new RoomNotFoundError(roomId);
    const deleted = writtenRowsOf<{ id: string }[]>(
      await this.client.from("rooms").delete().eq("id", roomId).select("id"),
    );
    if (deleted.length > 0) return;
    // Row-level security hides other users' rooms from a delete without an error, so ask which it was.
    if (await this.getRoom(roomId)) throw new NotRoomCreatorError(roomId);
    throw new RoomNotFoundError(roomId);
  }

  async currentAuthorName(): Promise<string | null> {
    return rowsOf<string | null>(await this.read((c) => c.rpc("current_author_name")));
  }

  async postMessage(roomId: string, { body }: { body: string }): Promise<Message> {
    if (!isUuid(roomId)) throw new RoomNotFoundError(roomId);
    const { data, error } = await this.client
      .from("messages")
      .insert({ room_id: roomId, body })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error?.code === FOREIGN_KEY_VIOLATION) throw new RoomNotFoundError(roomId);
    return messageFromRow(writtenRowsOf<MessageRow>({ data, error }));
  }
}
