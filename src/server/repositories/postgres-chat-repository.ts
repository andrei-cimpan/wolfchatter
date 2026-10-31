import type pg from "pg";
import { MESSAGE_LIMIT_DEFAULT, MESSAGE_LIMIT_MAX } from "@/lib/limits";
import type { Bbox, MapItem, Message, Room } from "@/lib/types";
import { RoomNotFoundError, type ChatRepository, type ListMessagesOptions } from "./chat-repository";
import { CLUSTER_MAX_ZOOM, clusterCellSize } from "@/lib/map-grid";
import { MAP_ITEMS_LIMIT, longitudeRanges, viewportCenter } from "./map-grid";

const FOREIGN_KEY_VIOLATION = "23503";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres rejects malformed uuid text with an error; to callers it is just an id that matches nothing.
function isUuid(value: string): boolean {
  return UUID.test(value);
}

type RoomRow = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  message_count: number;
  created_at: Date;
};

type MessageRow = {
  id: string;
  room_id: string;
  author: string;
  body: string;
  created_at: Date;
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
    createdAt: row.created_at.toISOString(),
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    roomId: row.room_id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at.toISOString(),
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

// Shared viewport filter: $1..$2 latitude, $3..$6 the two longitude ranges.
function viewportParams(bbox: Bbox): number[] {
  const [a, b] = longitudeRanges(bbox);
  return [bbox.south, bbox.north, a.from, a.to, b.from, b.to];
}
const IN_VIEWPORT = "lat between $1 and $2 and (lng between $3 and $4 or lng between $5 and $6)";

export class PostgresChatRepository implements ChatRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async getRoom(id: string): Promise<Room | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<RoomRow>(`select ${ROOM_COLUMNS} from rooms where id = $1`, [id]);
    return rows[0] ? toRoom(rows[0]) : null;
  }

  async createRoom({ lat, lng }: { lat: number; lng: number }): Promise<Room> {
    const { rows } = await this.pool.query<RoomRow>(
      `insert into rooms (lat, lng) values ($1, $2) returning ${ROOM_COLUMNS}`,
      [lat, lng],
    );
    return toRoom(rows[0]!);
  }

  async listMapItems({ bbox, zoom }: { bbox: Bbox; zoom: number }): Promise<MapItem[]> {
    if (zoom >= CLUSTER_MAX_ZOOM) {
      const { rows } = await this.pool.query<RoomRow>(
        `select ${ROOM_COLUMNS} from rooms where ${IN_VIEWPORT}
         order by created_at desc, id limit ${MAP_ITEMS_LIMIT}`,
        viewportParams(bbox),
      );
      return rows.map(toRoomItem);
    }

    // One row per grid cell. For a single-room cell the array_agg()[1] values are that room's.
    // Over the cap, the busiest cells win; among equally busy ones, those nearest the centre, so
    // the cap trims the padded edges the client asked for rather than whole rows of the view.
    // Longitude distance goes the short way round, for viewports that cross the antimeridian.
    const center = viewportCenter(bbox);
    const { rows } = await this.pool.query<CellRow>(
      `select count(*)::int as count, avg(lat) as lat, avg(lng) as lng,
              (array_agg(id))[1] as id, (array_agg(title))[1] as title,
              (array_agg(message_count))[1] as message_count
       from rooms where ${IN_VIEWPORT}
       group by floor(lat / $7), floor(lng / $7)
       order by count desc,
                power(avg(lat) - $8, 2) + power(least(abs(avg(lng) - $9), 360 - abs(avg(lng) - $9)), 2),
                floor(lat / $7), floor(lng / $7)
       limit ${MAP_ITEMS_LIMIT}`,
      [...viewportParams(bbox), clusterCellSize(zoom), center.lat, center.lng],
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
    const limit = clampLimit(opts.limit);

    // Ordering by (created_at, id) gives a total order: rows inserted in one transaction share
    // created_at, and an id cursor avoids the microseconds lost by a JavaScript Date.
    const cursorRow = "(select created_at, id from messages where id = $3 and room_id = $1)";
    if (after !== undefined) {
      const { rows } = await this.pool.query<MessageRow>(
        `select ${MESSAGE_COLUMNS} from messages
         where room_id = $1 and (created_at, id) > ${cursorRow}
         order by created_at, id limit $2`,
        [roomId, limit, after],
      );
      return rows.map(toMessage);
    }

    const olderThanCursor = before !== undefined ? `and (created_at, id) < ${cursorRow}` : "";
    const { rows } = await this.pool.query<MessageRow>(
      `select * from (
         select ${MESSAGE_COLUMNS} from messages
         where room_id = $1 ${olderThanCursor}
         order by created_at desc, id desc limit $2
       ) page order by created_at, id`,
      before !== undefined ? [roomId, limit, before] : [roomId, limit],
    );
    return rows.map(toMessage);
  }

  async postMessage(roomId: string, { author, body }: { author: string; body: string }): Promise<Message> {
    if (!isUuid(roomId)) throw new RoomNotFoundError(roomId);
    try {
      const { rows } = await this.pool.query<MessageRow>(
        `insert into messages (room_id, author, body) values ($1, $2, $3) returning ${MESSAGE_COLUMNS}`,
        [roomId, author, body],
      );
      return toMessage(rows[0]!);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === FOREIGN_KEY_VIOLATION) throw new RoomNotFoundError(roomId);
      throw error;
    }
  }
}
