import type { Message } from "./types";

/**
 * A `messages` row as it arrives: `created_at` is a `Date` from a `pg` query (test setup), and a
 * string with microseconds and an offset from PostgREST, `row_to_json` and Realtime.
 */
export type MessageRow = {
  id: string;
  room_id: string;
  author: string;
  body: string;
  created_at: Date | string;
};

/**
 * The API's `Message` for a row. Every path that serves a message goes through here, so a live
 * message equals a refetched one, `createdAt` included, cut to milliseconds by `toISOString()`.
 */
export function messageFromRow(row: MessageRow): Message {
  return {
    id: row.id,
    roomId: row.room_id,
    author: row.author,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
