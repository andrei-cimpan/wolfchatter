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
- **RoomPanel**: reads `?room` and fetches that room by id, so it works even when the pin is outside the viewport. No room selected: shows "Click on the map to start a chat". Otherwise shows the room title, the message list, a username field, and a message field with Submit.
- **MessageForm**: Submit is disabled while either field is empty. The username is saved to localStorage.
- **MessageList**: loads the latest page, appends live messages from the stream, and auto-scrolls to the newest.

## Responsive layout

- **Desktop (768 px and wider):** the map fills the screen and `RoomPanel` is a fixed-width column (about 380 px) on the right, as in the mockups.
- **Mobile (below 768 px):** `RoomPanel` becomes a bottom sheet over the map. With no room selected it shows only the "Click on the map to start a chat" banner. Selecting a room raises the sheet to about half the screen height, with a handle and a close button; the message list scrolls inside it and the form stays pinned to its bottom.
- The page uses `100dvh` so mobile browser toolbars do not cut off the form, and the viewport meta tag is set.
- Leaflet's `invalidateSize()` is called whenever the sheet or panel changes size, so the map never shows grey gaps.
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
- **Malformed or unknown ids match nothing.** `getRoom` returns `null`, `listMessages` returns `[]`, and `postMessage` throws `RoomNotFoundError`, which the API maps to 404.
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
| `POST /api/rooms` | Create a room `{lat, lng}` | 201 `Room` |
| `GET /api/rooms/:id/messages?before=&after=&limit=` | Page of messages, oldest first | 200 `Message[]` |
| `POST /api/rooms/:id/messages` | Post `{author, body}` | 201 `Message` |
| `GET /api/rooms/:id/stream` | SSE stream of new messages | 200 `text/event-stream` |

Errors use one shape: `{ "error": { "code": "...", "message": "..." } }`. Statuses: 400 validation, 404 unknown room, 429 rate limited.

## Viewport loading and clustering

1. The client sends the visible bounds and the integer zoom. Bounds are padded by about 20% and rounded, so small pans reuse the cached result.
2. The server filters rooms to the bounds. A viewport that crosses the antimeridian is split into two longitude ranges.
3. Below zoom 16, rooms are grouped into grid cells of `360 / 2^zoom * 0.25` degrees (about 64 px). A cell with one room returns that room. A cell with several returns a cluster at their average position, with its count. This is one grouped SQL query using `floor(lat / cell)` and `floor(lng / cell)`.
4. Responses are capped at 500 items. Clustering keeps wide views small, and at zoom 16 and above the viewport is small enough that the cap is rarely reached.
5. Clicking a cluster zooms the map into its cell, which triggers a new request.

The client keys the TanStack Query cache by bounds and zoom and keeps the previous result on screen while the next one loads, so pins do not flicker. A newly created room is added to the cache immediately. Rooms created by other users appear on the next pan or zoom, because real-time delivery covers messages only.

## Real-time delivery

1. A Postgres trigger sends `NOTIFY messages` with the new row as JSON on every insert.
2. Each app instance holds one `LISTEN messages` connection and keeps an in-memory map of `roomId -> SSE clients`.
3. On notify, the hub pushes the message to the clients subscribed to that room.
4. The stream sends a heartbeat comment every 25 seconds to keep proxies from closing it.
5. On reconnect, the client refetches with `after=<last seen message id>` to fill any gap, and de-duplicates by message id.

Because the trigger fires for every insert, messages posted through any instance reach every connected client.

## Testing approach

- **Unit**: zod schemas, clustering grid math, repository against a test database (including bounds that cross the antimeridian).
- **API**: route handlers with a real Postgres (Docker Compose).
- **E2E (Playwright)**: create pin, post, reload and see persistence; a second browser sees a posted message live.

## Known limitations (documented, not built)

- New rooms created by other users appear only after the next pan or zoom (real-time covers messages only).
- Clustering is grid-based over a plain `(lat, lng)` index. PostGIS with a GiST index is the next step at larger scale.
- No authentication, so authorship is self-declared.
- Basic per-IP rate limiting only.
