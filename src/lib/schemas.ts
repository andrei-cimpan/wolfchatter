import { z } from "zod";
import { normalizeBbox, wrapLongitude } from "./bbox";
import { AUTHOR_MAX, BODY_MAX, MAX_ZOOM, MESSAGE_LIMIT_MAX } from "./limits";

// Postgres char_length counts code points; String.length counts UTF-16 units, so an emoji
// would count twice and the API would reject text the database accepts.
function codePointLength(text: string): number {
  return [...text].length;
}

// Characters that draw nothing. trim() keeps most of them (U+200B, U+0085, U+3164...), so text
// made only of these would pass and render as a blank message. Default_Ignorable_Code_Point covers
// zero-width and filler characters; U+2800 (braille blank) is drawn as empty space but is not in it.
// A few format characters outside that property also draw nothing on their own: interlinear
// annotation marks (U+FFF9-FFFB), Egyptian hieroglyph format controls (U+13430-1343F) and the
// Khitan filler (U+16FE4). They are listed by name because all of \p{Cf} would also reject visible
// Arabic signs such as U+0600-0605.
const INVISIBLE =
  /[\p{White_Space}\p{Cc}\p{Default_Ignorable_Code_Point}⠀￹-￻\u{13430}-\u{1343F}\u{16FE4}]/gu;

function hasVisibleText(text: string): boolean {
  return text.replace(INVISIBLE, "").length > 0;
}

function requiredText(label: string, max: number) {
  return z
    .string()
    .trim()
    .refine(hasVisibleText, `${label} is required`)
    .refine((text) => codePointLength(text) <= max, `${label} must be at most ${max} characters`)
    // Postgres text rejects NUL outright (a 500, not a 400) and stores a lone surrogate as U+FFFD,
    // so the saved message would differ from what was sent.
    .refine((text) => !text.includes("\u0000") && text.isWellFormed(), `${label} contains invalid characters`);
}

// Plain decimals, with an optional exponent because JavaScript prints tiny coordinates as "1e-7".
const DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;

// Query values arrive as strings. Number() alone (and so z.coerce.number()) reads "" and "  "
// as 0 and accepts "0x10", "0b11" and "+5"; the pattern rejects those, and z.number() then
// rejects values that overflow to Infinity, such as "1e400".
function queryNumber<T extends z.ZodType<number, number>>(schema: T) {
  return z.string().trim().regex(DECIMAL, "Expected a decimal number").transform(Number).pipe(schema);
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
