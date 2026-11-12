import type { Message } from "./types";

/**
 * A `messages` row as Postgres hands it over: `created_at` is a `Date` from a query, and a string
 * with microseconds and an offset in a `NOTIFY` payload (`row_to_json`).
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
