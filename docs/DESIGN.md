# Wolfchatter: Design Note (v1)

How the system in `PRD.md` is built. One Next.js app, one Postgres database.

## Architecture

```
Browser (MapView + RoomPanel)
   |  REST (JSON)            ^  SSE (new messages)
   v                         |
Next.js route handlers  ---- Realtime hub (one pg LISTEN per instance)
   |                              ^
   v                              |
ChatRepository (Postgres)  --> Postgres --NOTIFY--> hub
```

## Project structure

```
src/
  app/                    # pages and route handlers
    api/rooms/...         # REST + SSE endpoints
  components/             # MapView, RoomPanel, MessageList, MessageForm
  hooks/                  # useRooms, useMessages, useRoomStream
  lib/                    # shared types, zod schemas, api client
  server/
    repositories/         # ChatRepository interface + PostgresChatRepository
    realtime/             # pg LISTEN + in-memory fan-out to SSE clients
supabase/ (v2 only)
db/migrations/            # SQL migrations
```

## UI behavior

- **MapView**: renders Leaflet. On load and after the map stops moving (debounced 250 ms) it requests `GET /api/rooms?bbox=&zoom=` and draws the result: a marker per room and a count bubble per cluster. Clicking empty map creates a room at that point and selects it. Clicking a marker selects that room. Clicking a cluster zooms in on it. Selection is written to `?room=<id>`.
- **Creating a room** (`ChatShell` owns the `useCreateRoom` mutation, since the map starts it and the panel shows its progress and errors): the new room is put in the TanStack Query cache, so the panel shows it without a refetch, and then selected. Clicks while a room is still being created are ignored (a ref, not `isPending`, because two clicks can land before React re-renders). Leaflet fires `click` for both halves of a double-click, so a click whose `detail` is above 1 is ignored; with the ref, that covers both a fast double-click and a slow one that lands after the first room exists. Double-click zoom is off too, because the first click already created a room and zooming as well would move the map away from its pin. A 429 tells the user how many seconds to wait (`Retry-After`).
- **Selection** is written with `history.pushState`, which Next.js keeps in sync with `useSearchParams` without a server round trip, so Back returns to the previous room. Until T3.3 loads pins by viewport, the map shows pins for the rooms created in this tab plus the selected room. Rooms store a wrapped longitude while the map repeats the world sideways, so each pin is drawn on the copy nearest the view's centre (`nearestWorldCopy`), except that the room just created stays on the copy that was clicked until the user drags or zooms (at low zoom several copies are on screen at once).
- **RoomPanel**: reads `?room` and fetches that room by id, so it works even when the pin is outside the viewport. A malformed id is treated like an unknown one ("This chatroom doesn't exist."), as the API does, without a request. No room selected: shows "Click on the map to start a chat". Otherwise shows the room title, the message list, a username field, and a message field with Submit. Until it has hydrated it renders "Loading chatroom…", because the map may already have fetched the same room into the cache, which would make its first client render differ from the server's. The prerendered page cannot know `?room`, so its fallback panel is a blank, `aria-busy` banner rather than the empty-state prompt, which would be wrong for a room link.
- **MessageForm**: Submit is disabled while either field is empty. The username is saved to localStorage.
- **MessageList**: loads the latest page, appends live messages from the stream, and auto-scrolls to the newest.

## Responsive layout

Mockups: [1 empty map](mockups/01-empty.jpg), [2 first room](mockups/02-first-room.jpg), [3 second room](mockups/03-second-room.jpg), [4 posting](mockups/04-post-message.jpg).

- **Desktop (768 px and wider):** the map fills the window and `RoomPanel` is a card floating over its top-right corner (380 px wide, 16 px from the edges), as in the mockups. The card grows with its content up to the window height minus its margins; past that it clips, and the message list (T3.4) scrolls inside it. The map never changes size, so it needs no `invalidateSize()` on desktop. The map starts on central Europe at zoom 5, as in the mockups.
- **Mobile (below 768 px):** `RoomPanel` becomes a bottom sheet. With no room selected it shows only the "Click on the map to start a chat" banner, placed in the page flow below the map rather than over it, so Leaflet's attribution (which OpenStreetMap's licence requires to stay visible) is not covered. Selecting a room raises the sheet to half the screen height (`50dvh`), with a handle and a 44 px close button that clears `?room`; the message list scrolls inside it and the form stays pinned to its bottom. The close button is mobile-only: the desktop card has none, as in the mockups.
- **Room card (mockups 2 to 4):** the title is centred at the top. Each message shows the author, then the body, with the date right-aligned below and a divider under it. The username field spans the card's width; the message field and Submit share the line below it.
- **Basemap:** OpenStreetMap tiles by default. `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` swap the provider (for example Stadia's Stamen Watercolor, the mockups' style, which needs an API key outside localhost). A custom URL without an attribution stops `next dev` and `next build` at startup (`next.config.ts` calls `tileConfigFromEnv` in `src/lib/map-config.ts`), rather than crashing the page in the browser.
- The page uses `100dvh` so mobile browser toolbars do not cut off the form, and the viewport meta tag is set.
- A `ResizeObserver` on the map's container calls Leaflet's `invalidateSize()` whenever the raised sheet changes the map's height, so the strip the sheet uncovers never stays grey. Leaflet handles window resizes itself.
- Touch targets are at least 44 px. Dragging the map must never create a room; only a tap does.

## Repository interface

```ts
type MapItem =
  | { type: "room"; id: string; title: string; lat: number; lng: number; messageCount: number }
  | { type: "cluster"; lat: number; lng: number; count: number };

interface ChatRepository {
  getRoom(id: string): Promise<Room | null>;
  listMapItems(query: {
    bbox: { west: number; south: number; east: number; north: number };
    zoom: number;
  }): Promise<MapItem[]>;
  createRoom(input: { lat: number; lng: number }): Promise<Room>;
  listMessages(
    roomId: string,
    opts?: { before?: string; after?: string; limit?: number }
  ): Promise<Message[]>;
  postMessage(
    roomId: string,
    input: { author: string; body: string }
  ): Promise<Message>;
}
```

`Room`, `Message`, and `MapItem` live in `src/lib/types.ts` so the UI can use them without importing server code. The rules the implementation follows:

- **Message cursors are message ids.** `before` returns the page just older than that message and `after` returns the messages newer than it, always oldest first. Messages are ordered by `(created_at, id)`, which keeps the order total when several rows share a `created_at` (as they do inside one transaction). It also avoids `created_at` cursors, which lose microseconds when they pass through a JavaScript `Date`. `limit` defaults to 50 and is capped at 100. Passing both `before` and `after` is an error.
- **Malformed or unknown ids match nothing.** `getRoom` returns `null`, `listMessages` returns `[]`, and `postMessage` throws `RoomNotFoundError`. The repository stays lenient so it never throws on bad input; the routes decide the status code (see Input validation).
- **Map items:** at zoom 16 and above, the newest 500 rooms in view. Below that, the 500 busiest grid cells.

Live delivery is a separate concern (`server/realtime`), so v2 can replace it with Supabase Realtime without touching the repository contract.

## Database

```sql
create sequence room_number_seq;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null default ('Chatroom ' || nextval('room_number_seq')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  message_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  author text not null check (char_length(author) between 1 and 32),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index messages_room_created_idx on messages (room_id, created_at);
create index rooms_location_idx on rooms (lat, lng);

create function on_message_insert() returns trigger as $$
begin
  update rooms set message_count = message_count + 1 where id = new.room_id;
  perform pg_notify('messages', row_to_json(new)::text);
  return new;
end;
$$ language plpgsql;

create trigger messages_notify after insert on messages
  for each row execute function on_message_insert();
```

## API

| Endpoint | Purpose | Success |
|---|---|---|
| `GET /api/rooms?bbox=w,s,e,n&zoom=z` | Rooms and clusters in the viewport (max 500 items) | 200 `MapItem[]` |
| `GET /api/rooms/:id` | One room | 200 `Room` |
| `POST /api/rooms` | Create a room `{lat, lng}` | 201 `Room`, with `Location: /api/rooms/:id` |
| `GET /api/rooms/:id/messages?before=&after=&limit=` | Page of messages, oldest first | 200 `Message[]` |
| `POST /api/rooms/:id/messages` | Post `{author, body}` | 201 `Message` (no `Location`: there is no single-message endpoint) |
| `GET /api/rooms/:id/stream` | SSE stream of new messages | 200 `text/event-stream` |

Errors use one shape: `{ "error": { "code": "...", "message": "..." } }`. The helpers live in `src/server/http/`.

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | A query or body fails its schema. `message` is the first issue, prefixed with its field, such as `bbox: south must not exceed north`. |
| 400 | `invalid_json` | A POST body labelled JSON that does not parse. |
| 413 | `payload_too_large` | A POST body over 16 KB (`JSON_BODY_MAX_BYTES`). Checked against `Content-Length` and while reading, so a streamed body without `Content-Length` is cut off too. |
| 415 | `unsupported_media_type` | A POST whose `Content-Type` is not `application/json` (parameters such as `; charset=utf-8` are fine, case is ignored; `+json` types are rejected). Checked before the body is read. |
| 404 | `room_not_found` | Unknown or malformed room id. |
| 429 | `rate_limited` | Too many POSTs from one IP (see Rate limiting). Sent with `Retry-After` in seconds. |
| 500 | `internal_error` | Anything unexpected. The cause is logged to stdout, never returned. |

### Rate limiting

Both POST routes are limited per client IP, in fixed one-minute windows: **10 rooms** (`POST /api/rooms`) and **30 messages** (`POST /api/rooms/:id/messages`). Creating rooms gets the tighter budget because every room litters the shared map. The limiters live in `src/server/http/rate-limit.ts`.

- **Configuration:** `RATE_LIMIT_ROOMS_PER_MINUTE` and `RATE_LIMIT_MESSAGES_PER_MINUTE` override the defaults. Unset or empty means the default; anything but a positive integer throws when the module loads, so a typo cannot silently change or disable a limit. Playwright sets both to 10,000 for its dev server, because every test browser posts from one address.

- **Order:** the limit is checked first, before the room id, `Content-Type`, and body. Every attempt spends budget, so a flood of invalid requests is limited too. GET routes are not limited.
- **Client IP:** route handlers cannot see the socket, so the IP is the **rightmost** `X-Forwarded-For` entry (`src/server/http/client-ip.ts`). Next.js sets that header to the socket address only when it is absent (`??=` in its base server), and a proxy such as the ALB appends the address it saw, so the rightmost entry is written by our side. Entries to its left are client-supplied and ignored. Requests with no usable address share one `unknown` key.
- **Budget key:** an IPv4 address is its own budget. An IPv6 address is keyed by its **/64** (`2001:db8:1:2::/64`), since one subscriber usually holds a whole /64 and could otherwise rotate through it for a fresh budget per request. IPv4-mapped IPv6 (`::ffff:203.0.113.7`) shares the IPv4 budget.
- **Why `Content-Type` is required:** a cross-site `<form enctype="text/plain">` can send a JSON-looking body with no CORS preflight, from each visitor's own browser and IP, which would spread a flood across many budgets. A form cannot send `application/json`, and a script that can needs a preflight, which we never grant.
- **Memory:** counters live in the instance's memory. Expired keys are swept once per window, and each limiter holds at most **10,000 keys** (about 1 MB). When it is full, the oldest window is dropped, so a client spread across more than 10,000 addresses (or /64s) in one minute can free keys early; that scale of attack is for the WAF.

### Input validation

Schemas live in `src/lib/schemas.ts`, and limits shared with the database and UI live in `src/lib/limits.ts`. Each route parses its input with these schemas before calling the repository.

- **Room id in the path** (`/api/rooms/:id` and `/api/rooms/:id/messages`): a value that fails `roomIdSchema` gets the same **404** as an unknown room, because to the caller both are "no such room". The id's format is checked before the query or body, so a malformed id is a 404 whatever else is wrong. Whether the room exists is checked only after the query or body validates, since that needs the database: invalid input to a well-formed but unknown room is a **400**. `GET .../messages` then looks the room up before listing, because `listMessages` answers `[]` for an unknown room; `POST` maps `RoomNotFoundError` to the 404.
- **Cursors** (`before`, `after`): must be UUIDs; a malformed cursor is a **400**, since it can only come from a broken client. A well-formed cursor that matches no message in the room (unknown, or from another room) returns **200 `[]`**, as the repository does; checking it would cost a query on every page for a case only a broken client reaches.
- **New room:** `lat` is a finite number in [-90, 90]. `lng` is any finite number, wrapped into ±180, so a click on a repeated copy of the world creates the room in the right place.
- **Message:** `author` (1 to 32 characters) and `body` (1 to 1000) are trimmed, and values with nothing visible are rejected: whitespace, control characters, zero-width and filler characters (Unicode `Default_Ignorable_Code_Point`, such as U+200B and U+3164), U+2800, and a few format characters that draw nothing on their own (U+FFF9 to U+FFFB, U+13430 to U+1343F, U+16FE4), which `trim()` mostly keeps. Those format characters are listed by name rather than as all of `\p{Cf}`, which would also reject visible Arabic signs such as U+0600 to U+0605. Line breaks inside the body are kept. Lengths count code points, as Postgres `char_length` does, so an emoji counts once.
- **Viewport:** `bbox=west,south,east,north` must be four finite numbers with `south <= north`, and `zoom` an integer from 0 to 22. `west > east` is accepted only when both are within ±180 (already-wrapped bounds that cross the antimeridian). Bounds are then normalized (see Viewport loading, step 1), which clamps latitudes to ±90 after the `south <= north` check.
- **Message paging:** `limit` is an integer from 1 to 100 (anything else is a 400), and `before` and `after` cannot be combined.
- **Query strings:** routes read only their own keys (`queryInput`). A missing key is absent, an empty value (`?limit=`) is kept as `""` so the schema rejects it, a repeated key uses its first value, and unknown keys are ignored.
- **Query numbers:** plain decimals only, optionally with an exponent (`1e-7`), and surrounding whitespace is ignored. Empty strings, hex, binary, a leading `+`, `NaN` and values that overflow to `Infinity` are rejected rather than coerced.

## Viewport loading and clustering

1. The client sends the visible bounds and the integer zoom. Bounds are padded by about 20% and rounded, so small pans reuse the cached result. After panning across the antimeridian, Leaflet reports longitudes outside ±180 (for example `west=170, east=190`). The API's bbox schema (T1.3) wraps both ends into [-180, 180], treats a span of 360° or more as the whole world, and rejects non-finite values. The repository therefore only sees wrapped bounds, where `west > east` means the viewport crosses the antimeridian.
2. The server filters rooms to the bounds. A viewport that crosses the antimeridian is split into two longitude ranges.
3. Below zoom 16, rooms are grouped into grid cells of `360 / 2^zoom * 0.25` degrees (about 64 px). A cell with one room returns that room. A cell with several returns a cluster at their average position, with its count. This is one grouped SQL query using `floor(lat / cell)` and `floor(lng / cell)`.
4. Responses are capped at 500 items. Below zoom 16 the busiest cells are kept; at zoom 16 and above, the newest rooms. A large, dense viewport can still reach the cap at normal zooms (a padded 1920×1080 view is about 720 cells), and then the sparsest cells are dropped (see Known limitations).
5. Clicking a cluster zooms the map into its cell, which triggers a new request.

The client keys the TanStack Query cache by bounds and zoom and keeps the previous result on screen while the next one loads, so pins do not flicker. A newly created room is added to the cache immediately. Rooms created by other users appear on the next pan or zoom, because real-time delivery covers messages only.

## Real-time delivery

1. A Postgres trigger sends `NOTIFY messages` with the new row as JSON on every insert.
2. Each app instance holds one `LISTEN messages` connection and keeps an in-memory map of `roomId -> SSE clients`.
3. On notify, the hub pushes the message to the clients subscribed to that room.
4. The stream sends a heartbeat comment every 25 seconds to keep proxies from closing it.
5. On reconnect, the client refetches with `after=<an id a few messages before the last one it saw>` and de-duplicates by message id. The overlap matters because `created_at` is the inserting transaction's start time, not its commit time: a message can commit after a newer one yet sort before it, so `after=<last seen id>` could skip it for good.

Because the trigger fires for every insert, messages posted through any instance reach every connected client.

## Testing approach

- **Unit**: zod schemas, clustering grid math, repository against a test database (including bounds that cross the antimeridian).
- **API**: route handlers with a real Postgres (Docker Compose).
- **E2E (Playwright)**: create pin, post, reload and see persistence; a second browser sees a posted message live. Playwright starts its own dev server on port 3100 (`E2E_PORT`), never `npm run dev` on 3000, and fails if that port is busy unless `E2E_REUSE_SERVER=1`, so it cannot silently test another checkout's server, with `DATABASE_URL` set to `E2E_DATABASE_URL`. Its global setup creates and migrates that database (its name must end in `_e2e`) and empties it once per run, so tests never write to the dev database and must not depend on each other's rooms.

## Known limitations (documented, not built)

- New rooms created by other users appear only after the next pan or zoom (real-time covers messages only).
- Clustering is grid-based over a plain `(lat, lng)` index. PostGIS with a GiST index is the next step at larger scale.
- When a viewport has more than 500 occupied cells, the sparsest are dropped, so the shown counts can add up to fewer rooms than are in view. Merging the remainder into coarser clusters would fix it.
- No authentication, so authorship is self-declared.
- Basic per-IP rate limiting only. Counters are per instance, so N instances allow N times the limit, and a restart resets them; production adds a per-IP rule at the WAF (see `INFRA.md`), and a shared store such as Redis is the next step.
- The client IP is trusted from `X-Forwarded-For`, so the app must sit behind a proxy that appends to it. Exposed directly, a client can set the header and pick a fresh key for every request.
- A fixed window lets one IP send up to twice the limit across a window boundary.
