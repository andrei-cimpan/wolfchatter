import { z } from "zod";
import { normalizeBbox, wrapLongitude } from "./bbox";
import { AUTHOR_MAX, BODY_MAX, MAX_ZOOM, MESSAGE_LIMIT_MAX } from "./limits";

// Postgres char_length counts code points; String.length counts UTF-16 units, so an emoji
// would count twice and the API would reject text the database accepts.
function codePointLength(text: string): number {
  return [...text].length;
}

function requiredText(label: string, max: number) {
  return z
    .string()
    .trim()
    .refine((text) => codePointLength(text) >= 1, `${label} is required`)
    .refine((text) => codePointLength(text) <= max, `${label} must be at most ${max} characters`);
}

// Query values arrive as strings. z.coerce.number() would read "" as 0 and "1e400" as
// Infinity; z.number() rejects NaN and Infinity, so both fail here instead.
function queryNumber<T extends z.ZodType<number, number>>(schema: T) {
  return z.string().trim().min(1, "Expected a number").transform(Number).pipe(schema);
}

export const roomIdSchema = z.uuid();

export const createRoomSchema = z.object({
  lat: z.number().min(-90).max(90),
  // A click on a repeated copy of the world gives Leaflet a longitude such as 200.
  lng: z.number().transform(wrapLongitude),
});

export const postMessageSchema = z.object({
  author: requiredText("Author", AUTHOR_MAX),
  body: requiredText("Message", BODY_MAX),
});

const bboxParam = z
  .string()
  .transform((value) => value.split(","))
  .pipe(
    z.tuple([queryNumber(z.number()), queryNumber(z.number()), queryNumber(z.number()), queryNumber(z.number())]),
  )
  .transform(([west, south, east, north]) => ({ west, south, east, north }))
  .refine((b) => b.south <= b.north, "south must not exceed north")
  .refine(
    (b) => b.west <= b.east || (b.west <= 180 && b.east >= -180),
    "west may exceed east only for wrapped bounds that cross the antimeridian",
  )
  .transform(normalizeBbox);

/** Query string of GET /api/rooms: `bbox=west,south,east,north&zoom=z`. */
export const mapItemsQuerySchema = z.object({
  bbox: bboxParam,
  zoom: queryNumber(z.number().int().min(0).max(MAX_ZOOM)),
});

/** Query string of GET /api/rooms/:id/messages. */
export const listMessagesQuerySchema = z
  .object({
    before: z.uuid().optional(),
    after: z.uuid().optional(),
    limit: queryNumber(z.number().int().min(1).max(MESSAGE_LIMIT_MAX)).optional(),
  })
  .refine((q) => q.before === undefined || q.after === undefined, {
    message: "Use before or after, not both",
    path: ["after"],
  });

export type CreateRoomInput = z.output<typeof createRoomSchema>;
export type PostMessageInput = z.output<typeof postMessageSchema>;
export type MapItemsQuery = z.output<typeof mapItemsQuerySchema>;
export type ListMessagesQuery = z.output<typeof listMessagesQuerySchema>;
