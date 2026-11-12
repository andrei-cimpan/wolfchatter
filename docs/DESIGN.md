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
ChatRepository (Supabase API) --> Postgres --NOTIFY--> hub
```

## Project structure

```
src/
  app/                    # pages and route handlers
    api/rooms/...         # REST + SSE endpoints
    health/               # GET /health
  instrumentation.ts      # checks the rate limits, registers the shutdown handler
  components/             # ChatShell (draft + creation), MapView/LeafletMap/MapMarkers (map),
                          # RoomPanel, MessageList, MessageForm, VisibleAlert, Providers
  hooks/                  # React hooks: data (useRoom, useMapItems, useMessages, usePostMessage,
                          # useCreateRoom), live messages (useRoomStream), the draft (useDraft),
                          # selection in the URL (useSelectedRoom), the map (useFlyToRoom), useHydrated
  lib/                    # no React and no server code: shared types, zod schemas, API client,
                          # message cache and catch-up, draft reducer, map and viewport math
  server/
    http/                 # route helpers: errors, JSON bodies, query strings, rate limits, SSE, /health
    repositories/         # ChatRepository + SupabaseChatRepository, PostgresMessageSource (pg LISTEN)
    realtime/             # MessageSource interface, RealtimeHub (in-memory fan-out, heartbeat), shutdown
supabase/                 # local stack config (config.toml) and SQL migrations
e2e/                      # Playwright specs; shared locators in chat-page.ts, fixtures in support.ts
```

## UI behavior

- **MapView**: renders Leaflet. On load and after the map stops moving (debounced 250 ms, and skipped while the zoom is not whole: a sheet resizing the map ends a move in mid-flight, and the landing reports instead) it requests `GET /api/rooms?bbox=&zoom=` (`useMapItems`) and draws the result: a marker per room and a count bubble per cluster. Clicking empty map drops a draft pin at that point (below). Pressing Enter with the map itself focused drops one at the centre of what the card leaves clear; the arrow keys move the map first, and the map's accessible name says so. Leaflet also focuses the map on any press, so Enter does nothing while the map's focus came from a pointer: someone who typed a message and dragged the map could otherwise lose their room or move their draft. There is no visible hint or crosshair for sighted keyboard users yet. Clicking a marker selects that room. Clicking a cluster, or pressing Enter or Space on it, fits the map to the grid cell it was grouped in (computed from the zoom of the result it came from, at most zoom 16), which zooms in about three levels on a desktop view (a 64 px cell fitted to the map), fewer on a narrow screen. Near the poles Mercator stretches a cell until it fits no higher zoom, so the click always goes at least one level up, and some of the cell's rooms may then start off-screen. Bubbles are at least 44 px, grow with the count, and are named "N chatrooms" for screen readers. Selection is written to `?room=<id>`.
- **Draft pins:** a click on the map saves nothing. It drops a draft (`useDraft` state in `ChatShell`, not the URL, so a reload loses it; its transitions are the pure `draftReducer` in `src/lib/draft.ts`): a grey pin titled "New chatroom (not created yet)" and a panel titled "New chatroom" with the note "Send the first message to create this chatroom. Until then, nobody else can see it." above the usual form. A stray click therefore costs nothing and leaves nothing on the shared map, where there is no way to delete a room. Clicking elsewhere moves the draft and keeps what was typed, since the place was probably just misjudged. `Discard` removes it, as does the sheet's close button, and leaves the focus on the map; the sheet has `Discard` in its header, where it costs no height, and the desktop card below the form. Both show as unavailable while the first message is being sent. The note is a `role="status"` region, so screen readers hear it. A click or Enter past the edge of the map's world (about 85° north or south), where the map can be panned, drops nothing, since a pin could not be drawn there. Clicking the grey pin does nothing: without a listener Leaflet would pass the click to the map and move the draft. Opening a room from a pin also ends the draft. Clicking the map with a room open closes the room and starts a draft, adding a history entry. Back or Forward ends a draft, and its text goes with it, as when opening a room. During a send it ends the draft only if the send fails, without showing the error, since the text it would explain is gone; if the send succeeds the room exists as usual.
- **Clicks and double-clicks:** a click waits to see if another follows (`ClickToDraft`), and a double-click zooms the map and leaves no pin. With a room or draft open the wait is 500 ms, which covers a typical double-click, since acting early would destroy what is open and the flight would move the map before the zoom. On an empty map, with nothing to lose, it is 250 ms, and a slower double-click takes back the pin its first click dropped, even if its second click lands on that pin (`preclick`, since a pin keeps its clicks from the map); the browser's `detail` tells the two clicks apart. Double-clicking the pin of a draft dropped earlier only zooms. Anything else during the wait (a pin click, Back or Forward, a drag, a zoom, a cluster click) means the user moved on, so the click drops nothing. Leaflet sends no click after a drag, so panning never drops a pin.
- **Creating a room** (`ChatShell` owns the `useCreateRoom` mutation, since the map shows the draft and the panel its form and errors): the first message and the room are saved in one request (`POST /api/rooms` with `firstMessage`, one database transaction), so a failed post cannot leave an empty room, and the draft and its text stay for another try. The room and its first message are put in the TanStack Query cache, so the panel shows them without a refetch, every viewport query is invalidated so the map refetches its pins (only the server knows whether the new room joins a cluster), the room is then selected, and the message field takes the focus so the writer can carry on. Next.js applies `?room` in a transition, so the draft stays in state (`savedAs`) until the panel sees the new selection; clearing it at once would drop the sheet for a frame. A draft that closed an open room owns the history entry for the map with no room, and saving replaces that entry, so Back returns to the previous room rather than to a draft that is gone. Saving a draft started from the empty map adds a new entry, so Back returns to the empty map. Clicks on the map while the message is being sent are ignored (a ref, not `isPending`, because a second Enter can land before React re-renders), and a pin picked meanwhile keeps that pick. A 429 tells the user how many seconds to wait (`Retry-After`).
- **Selection** is written with `history.pushState`, which Next.js keeps in sync with `useSearchParams` without a server round trip, so Back returns to the previous room. The selected room always gets a pin, even when it is clustered, outside the view, or not loaded yet. Rooms store a wrapped longitude while the map repeats the world sideways, so each pin is drawn on the copy nearest the view's centre (`nearestWorldCopy`), except that the newest pin, draft or room, stays on the copy that was clicked until the user drags or zooms (at low zoom several copies are on screen at once). Whenever the selection changes (a pin, a draft dropped or moved, a new room, Back or Forward), the map flies to that pin at the current zoom (`useFlyToRoom`), and a drag or the wheel stops the flight. A flight passes through fractional zooms, so a new selection during one keeps the zoom it was heading to, and a drag that stops one returns the map to that zoom afterwards, or to the nearest whole zoom if a zoom button cleared it just after the flight began. A page opened on a room starts there without a flight, and reduced motion always jumps. Below 768 px the sheet shrinks the map, so the pin is centred in what is left. From 768 px the card floats over the map, so the pin is centred in the part left of the card (396 px, the card and its margin, which is about 15 px short under a 47 px notch, a difference too small to act on), by at most just under half a world (`focusShiftPx`), since past that the pin would move to the next copy once the map stops. Flying to a room already in view still moves the map, so a selected pin always ends in the same place. Viewport queries spell longitudes on one copy of the world (`west` in [-180, 180)), so a flight or a pan onto another copy reuses what is cached.
- **RoomPanel**: reads `?room` and fetches that room by id, so it works even when the pin is outside the viewport. A malformed id is treated like an unknown one ("This chatroom doesn't exist."), as the API does, without a request. No room selected: shows "Click on the map to start a chat", or the draft if there is one. Otherwise shows the room title, the message list, a username field, and a message field with Submit. Until it has hydrated it renders "Loading chatroom…", because the map may already have fetched the same room into the cache, which would make its first client render differ from the server's. The prerendered page cannot know `?room`, so its fallback panel is a blank, `aria-busy` banner rather than the empty-state prompt, which would be wrong for a room link.
- **MessageForm**: used by a room (`RoomMessageForm`, which posts to it) and by a draft (which creates the room). A username field, then the message field and Submit. Before sending, the input is checked with the API's own schema (`postMessageSchema`). Submit shows as disabled while that check fails or a post is sending, so a field with nothing visible counts as empty. It uses `aria-disabled` rather than `disabled`, so it keeps keyboard focus through a failed post and Enter can still explain what is missing: an empty field gets the browser's `required` prompt, a value with nothing visible gets "Enter a username." or "Enter a message." without a request, and text the API would refuse although it looks fine (a pasted NUL) gets the schema's own message. A hint lasts until the input is fixed. The fields' `maxLength` counts UTF-16 units, so they are never more lenient than the API, which counts code points. A second submit while one is on its way is ignored (a ref, as for room creation). On success the message field clears and keeps focus; on failure the text stays and the error is shown (a 429 says how long to wait), scrolled into view if the panel has run out of height (`VisibleAlert`, which the room creation error uses too). The username lives in `RoomPanel` state, so it carries over between rooms, while each room mounts its own form (the room's content is keyed by room id), so an unsent message stays behind. It is also saved to localStorage on every change and read back when the panel mounts (`src/lib/saved-username.ts`), in both directions through the API's own `author` rule: what is stored is trimmed, and a value that could not be posted (empty, nothing visible, too long) is forgotten rather than restored. The field itself keeps what is typed, or the space in "ana b" could never be entered. Reading it back cannot cause a hydration mismatch, since the form renders only after hydration. If storage is blocked, the username lasts until a reload.
- **MessageList**: loads the room's latest page (50 messages, oldest first) with `useMessages`, and scrolls inside the card or sheet while the form stays below it. Author and body render as plain text with line breaks kept. The messages sit in a `role="log"` region, which screen readers announce as it grows, so the loading, error, and empty states stay outside it, and the room's content is keyed by room id so each room mounts a fresh log with its history already in it rather than announcing it. A posted message is added to the cached list from the POST response, and a live one from the stream (`useRoomStream`, see Real-time delivery), both through `addMessage` (`mergeMessages`, which skips ids it already has and keeps the server's order rather than re-sorting by `createdAt`, whose milliseconds can tie where Postgres's microseconds do not). If the list never loaded, or a refetch that may predate the message is in flight, the list is refetched instead. The list still refetches when the window regains focus or the room is reopened, which covers a stream that keeps failing. Its error state shows only when there is no list to show: a failed refetch keeps the loaded list and the reader's place, without an error, until the stream or the next refetch catches it up. It scrolls to the newest message when the room opens and whenever a newer one is added, since the raised sheet's list fits only a message or two and a post would otherwise land out of sight. A reader who has scrolled up (more than 32 px from the bottom, `isNearBottom`, recorded on each scroll because an effect would measure the list after it has grown) stays where they are when a message arrives, and follows again once back at the bottom. A reader who is following stays at the bottom when the list changes size too (`ResizeObserver`), and a scroll event that arrives before the list has seen its new size is ignored, since rewrapping moves `scrollTop` without the reader doing anything. Their own post is the exception: it always comes into view, so `RoomContent` passes a count of sent posts from the form to the list. Nothing marks new messages below a reader who has scrolled up; screen readers still hear them through the log.

## Responsive layout

Mockups: [1 empty map](mockups/01-empty.jpg), [2 first room](mockups/02-first-room.jpg), [3 second room](mockups/03-second-room.jpg), [4 posting](mockups/04-post-message.jpg).

The mockups show a room as soon as the map is clicked. Since T5.5 a click opens a draft first, and the room in mockup 2 appears after the first message.

- **Desktop (768 px and wider):** the map fills the window and `RoomPanel` is a card floating over its top-right corner (380 px wide, 16 px from the edges), as in the mockups. The card grows with its content up to the window height minus its margins; past that the message list (T3.4) scrolls inside it, and the card itself scrolls once even the form does not fit. The map never changes size, so it needs no `invalidateSize()` on desktop. The map starts on central Europe at zoom 5, as in the mockups.
- **Mobile (below 768 px):** `RoomPanel` becomes a bottom sheet. With no room selected it shows only the "Click on the map to start a chat" banner, placed in the page flow below the map rather than over it, so Leaflet's attribution (which OpenStreetMap's licence requires to stay visible) is not covered. Selecting a room or dropping a draft raises the sheet to half the screen height, but at least 320 px (`max(50dvh, 20rem)`), with a handle and a 44 px close button that clears `?room`; the message list scrolls inside it and the form stays at its bottom, unless an error line or a very short screen makes the panel itself scroll. Everything but the list takes about 237 px, so the minimum leaves the list about 83 px, which fits one whole message. The sheet also always leaves the map 112 px (`min(max(50dvh, 20rem), 100dvh - 7rem)`), enough for its zoom buttons and attribution, and the panel scrolls if that makes it too short. The close button is mobile-only: the desktop card has none, as in the mockups.
- **Phone on its side (below 768 px, landscape, at most 500 px high; the `short-wide` variant):** half a short screen cannot hold the form, and a sheet tall enough to hold it would leave too little map for its zoom buttons and attribution. So an open room or a draft takes the right half of the screen at full height, without the handle, and the map takes the left half. The map still shrinks as it does for the sheet, so the existing resize handling and pin centring apply. With no room open the banner stays below the map. From 768 px wide a phone on its side gets the desktop card.
- **Very short windows (including high browser zoom):** the message list keeps at least 80 px below 768 px wide and below 320 px high, and the panel itself scrolls when the form still does not fit, so Submit can always be reached. The desktop card has no minimum otherwise, because it grows with its content and a minimum would only add empty space to a quiet room. At 320 px high and above the card leaves the list about 100 px, less any error lines.
- **Room card (mockups 2 to 4):** the title is centred at the top. Each message shows the author, then the body, with the date right-aligned below and a divider under it. The username field spans the card's width; the message field and Submit share the line below it, and in a panel too narrow for both (very narrow side-by-side windows, such as high browser zoom) Submit wraps to its own line.
- **Basemap:** OpenStreetMap tiles by default. `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` swap the provider (for example Stadia's Stamen Watercolor, the mockups' style, which needs an API key outside localhost). A custom URL without an attribution stops `next dev` and `next build` at startup (`next.config.ts` calls `tileConfigFromEnv` in `src/lib/map-config.ts`), rather than crashing the page in the browser.
- The page uses `100dvh` so mobile browser toolbars do not cut off the form, and the viewport meta tag is set.
- A `ResizeObserver` on the map's container calls Leaflet's `invalidateSize()` whenever the raised sheet changes the map's height, so the strip the sheet uncovers never stays grey. Leaflet handles window resizes itself.
- Touch targets are at least 44 px, except room pins, which are Leaflet's default 25x41 px. A tap that just misses a pin counts as a click on the map, which closes an open room and drops a draft. Tried on a real phone in T7.4, pins worked at this size, so they have no larger hit area. Dragging the map must never create a room; only a tap does.

## Repository interface

```ts
type MapItem =
  | { type: "room"; id: string; title: string; lat: number; lng: number; messageCount: number }
  | { type: "cluster"; lat: number; lng: number; count: number };

interface ChatRepository {
  ping(): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
  listMapItems(query: {
    bbox: { west: number; south: number; east: number; north: number };
    zoom: number;
  }): Promise<MapItem[]>;
  createRoom(input: { lat: number; lng: number }): Promise<Room>;
  createRoomWithMessage(
    room: { lat: number; lng: number },
    message: { author: string; body: string }
  ): Promise<{ room: Room; message: Message }>;
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

**On `v2`** the implementation is `SupabaseChatRepository`, which goes through the Supabase API (PostgREST) and runs no SQL of its own. Reads with paging, the viewport and clustering, and creating a room with its first message are SQL functions in the migration (`list_messages`, `list_rooms_in_view`, `list_room_cells`, `create_room_with_message`), called with `.rpc`, so each runs in one transaction. `getChatRepository(request)` builds a client per request from that request's cookies, so row-level security sees the caller; it reads the `Request`, not `next/headers`, which keeps route tests free of mocks. It has no response to save cookies to, so a session it refreshed would be lost and could sign the user out. The client refreshes an access token within 90 s of expiry before every request whatever `autoRefreshToken` says (that only stops the background timer), so routes rely on the session proxy (Task 5) refreshing first; Task 5 must test that a route given a nearly expired cookie makes no refresh call. `ping()` is a head-only `select` on `rooms`. It and `getRoom`, which the room, messages and stream routes call first, turn off the client's retries for reads, so `/health` and those routes fail at once rather than after about 7 s of backoff when the API is down; `.rpc` calls are POSTs, which are never retried. `next.config.ts` checks `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at startup.

Live delivery is a separate concern (`server/realtime`), so v2 can replace it with Supabase Realtime without touching the repository contract. Until then, the hub's `LISTEN` connects to `SUPABASE_DB_URL`.

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
| `POST /api/rooms` | Create a room `{lat, lng}`, with an optional `firstMessage: {author, body}` saved in the same transaction | 201 `Room`, plus `firstMessage: Message` if one was sent, with `Location: /api/rooms/:id` |
| `GET /api/rooms/:id/messages?before=&after=&limit=` | Page of messages, oldest first | 200 `Message[]` |
| `POST /api/rooms/:id/messages` | Post `{author, body}` | 201 `Message` (no `Location`: there is no single-message endpoint) |
| `GET /api/rooms/:id/stream` | SSE stream of new messages (see Real-time delivery) | 200 `text/event-stream` |
| `GET /health` | Whether this instance can reach its database within 2 s (see Deployment) | 200 `{"status":"ok"}`, or 503 `{"status":"unavailable"}` |

Errors use one shape: `{ "error": { "code": "...", "message": "..." } }`. The helpers live in `src/server/http/`.

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | A query or body fails its schema. `message` is the first issue, prefixed with its field, such as `bbox: south must not exceed north`. |
| 400 | `invalid_json` | A POST body labelled JSON that does not parse. |
| 413 | `payload_too_large` | A POST body over 16 KB (`JSON_BODY_MAX_BYTES`). Checked against `Content-Length` and while reading, so a streamed body without `Content-Length` is cut off too. |
| 415 | `unsupported_media_type` | A POST whose `Content-Type` is not `application/json` (parameters such as `; charset=utf-8` are fine, case is ignored; `+json` types are rejected). Checked before the body is read. |
| 404 | `room_not_found` | Unknown or malformed room id. |
| 429 | `rate_limited` | Too many POSTs from one IP (see Rate limiting). Sent with `Retry-After` in seconds. |
| 500 | `internal_error` | Anything unexpected. The cause is logged to stderr, never returned. |

### Rate limiting

Both POST routes are limited per client IP, in fixed one-minute windows: **10 rooms** (`POST /api/rooms`, whose optional first message counts only here) and **30 messages** (`POST /api/rooms/:id/messages`). Creating rooms gets the tighter budget because every room litters the shared map. The limiters live in `src/server/http/rate-limit.ts`.

- **Configuration:** `RATE_LIMIT_ROOMS_PER_MINUTE` and `RATE_LIMIT_MESSAGES_PER_MINUTE` override the defaults. Unset or empty means the default; anything but a positive integer throws when the module loads, so a typo cannot silently change or disable a limit. `src/instrumentation.ts` loads it at startup and exits with an error, because Next would only log a failed startup hook and go on listening, answering 500. Playwright sets both to 10,000 for its dev server, because every test browser posts from one address.

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

1. The client sends the visible bounds and the integer zoom (`src/lib/viewport.ts`). Each side is padded by 10% of the view's span, then snapped outward to whole tiles at that zoom, so returning to an area reuses its cached result. The client keeps its current query while the view stays inside the area it loaded at the same zoom, because a pan of a few pixels can still push a padded edge across a tile boundary. After panning across the antimeridian, Leaflet reports longitudes outside ±180 (for example `west=170, east=190`). The API's bbox schema (T1.3) wraps both ends into [-180, 180], treats a span of 360° or more as the whole world, and rejects non-finite values. The repository therefore only sees wrapped bounds, where `west > east` means the viewport crosses the antimeridian.
2. The server filters rooms to the bounds. A viewport that crosses the antimeridian is split into two longitude ranges.
3. Below zoom 16, rooms are grouped into grid cells of `360 / 2^zoom * 0.25` degrees (about 64 px). A cell with one room returns that room. A cell with several returns a cluster at their average position, with its count. This is one grouped SQL query using `floor(lat / cell)` and `floor(lng / cell)`.
4. Responses are capped at 500 items. Below zoom 16 the busiest cells are kept, and among equally busy cells those nearest the viewport's centre, so the padding is dropped before cells in view; at zoom 16 and above, the newest rooms. A large, dense viewport can still reach the cap at normal zooms (near the equator a padded and snapped 1280×720 view covers up to about 560 cells and a 1920×1080 one up to about 960; fewer at higher latitudes, where a degree of latitude takes more pixels), and then the sparsest cells are dropped (see Known limitations).
5. Clicking a cluster zooms the map into its cell, which triggers a new request. The cell size is shared by the server and the client (`src/lib/map-grid.ts`).

The client keys the TanStack Query cache by bounds and zoom and keeps the previous result on screen while the next one loads, so pins do not flicker. Results stay fresh for 30 seconds. A failed request is retried once; after that the last pins that loaded stay on screen (`keepPreviousData` covers only a pending query, so `useMapItems` remembers them itself) and no error is shown. The failed query is tried again when the view leaves its area or changes zoom, or when the window regains focus. Creating a room invalidates every viewport query. Rooms created by other users appear when the map moves to an area or zoom it has no fresh result for (none cached, or older than 30 seconds), or when the window regains focus, because real-time delivery covers messages only.

## Real-time delivery

1. A Postgres trigger sends `NOTIFY messages` with the new row as JSON on every insert.
2. Each app instance holds one `LISTEN messages` connection (`PostgresMessageSource`) on its own `pg.Client`, not a pool client, since a pool may close or reuse the session that holds the `LISTEN`. It checks each payload with Zod and turns it into the API's `Message` shape (`createdAt` cut to milliseconds by `toISOString()`, as the REST API does), so a live message equals a refetched one. A malformed payload is logged and dropped. A connection dropped without an error (a NAT or load balancer forgetting it) would leave `LISTEN` silent for good, so the source runs `select 1` every 30 seconds and treats a failure as a drop; connecting, that check, and closing each give up after 10 seconds, and TCP keepalive is on. It lives in `repositories/` because only that folder may import the DB client.
3. The hub (`RealtimeHub`, `src/server/realtime/`) keeps an in-memory map of `roomId -> subscribers` and pushes each message to that room's subscribers. One hub per process (`getRealtimeHub()`, kept on `globalThis` like the pool). Because the hub survives Next dev's module reloads, edits to the hub or the source take effect only after restarting `npm run dev`. `stopRealtimeHub()` closes every stream and the `LISTEN` connection (see Deployment for when). It starts the source on the first `subscribe`, which resolves only while `LISTEN` is active (waiting out an outage if there is one), so a stream that opens before a post cannot miss it. If the first connection fails, `subscribe` rejects and the next one tries again. A subscriber whose `send` or `heartbeat` throws is dropped and closed without affecting the others.
4. While anyone is subscribed, one shared timer calls each subscriber's `heartbeat` every 25 seconds; the SSE stream writes a comment to keep proxies from closing it.
5. If the `LISTEN` connection drops, the source reconnects with backoff (1 s doubling to 30 s). The wait drops back to 1 s only after a connection has stayed up for 30 s, so a database that keeps dropping connections right after accepting them is not retried at the shortest wait, with every stream closed each time. Messages sent during the gap never reach the hub, so the moment the connection drops, the hub closes every subscriber rather than leaving streams open that look healthy (heartbeats keep coming) but cannot receive anything. Each client then reconnects; its `subscribe` waits until `LISTEN` is back, and it catches up as below, the same path as any other dropped stream.
6. On reconnect, the client refetches with `after=<an id a few messages before the last one it saw>` and de-duplicates by message id. The overlap matters because `created_at` is the inserting transaction's start time, not its commit time: a message can commit after a newer one yet sort before it, so `after=<last seen id>` could skip it for good.

**The stream route** (`GET /api/rooms/:id/stream`, body built by `openRoomEventStream` in `src/server/http/room-event-stream.ts`). A malformed or unknown room gets the usual JSON 404. `EventSource` treats it as final, so the hook retries it on its slow backoff (below) rather than every second or two; that is rare, since `MessageList` mounts only for a room that loaded. Otherwise the route answers 200 at once and the stream sends, in order:

- `retry: <1000 to 1999>`, so the browser reconnects 1 to 2 s after the stream ends, picked at random per stream so that clients the hub dropped together (an outage) do not all return in the same instant;
- `event: ready` (data `{}`) once the hub's `subscribe` has resolved, meaning nothing posted from then on can be missed;
- `event: message` with the `Message` as JSON, one per new message in the room;
- a `: ping` comment on each heartbeat.

The headers are `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, so compression and proxies pass events on as they are written. The stream ends when the hub closes the subscriber (an outage or shutdown), the client leaves (the request's abort signal, or the body being cancelled), `subscribe` rejects, the client stops reading, or `subscribe` has not resolved after 10 seconds (`STREAM_SUBSCRIBE_TIMEOUT_MS`). A client has stopped reading (a backgrounded phone, a NAT that forgot the connection) once 256 writes (`STREAM_MAX_BACKLOG`) are queued beyond what its socket buffer took. Without this limit the queue grows with every message until TCP gives up. Next reads the body with backpressure, so the queue measures this: under the production server a stalled client's queue grew by one per write, and a reading client's stayed under 5 through 20,000 messages in 8 s. This ends the stream with `controller.error`, since `close` keeps the queue until it is read; Next logs one "failed to pipe response" for it, and the client reconnects and catches up as after any drop. The subscribe timeout exists because `subscribe` waits out an outage with no limit; ending the stream makes the browser retry rather than hold a connection that looks open but cannot receive anything. If the client leaves or the timeout fires while `subscribe` is still waiting, the route calls the unsubscribe it returns as soon as it resolves, so the subscriber does not linger in the hub until a write fails.

**The client hook** (`useRoomStream`, called by `MessageList`, so switching rooms closes the old stream). A hidden tab holds no stream, and opens one when shown, which catches up as below: browsers allow six HTTP/1.1 connections per host across all tabs, so without this six tabs on a room left a seventh unable to load anything. `connectRoomStream` (`src/lib/room-stream.ts`) opens an `EventSource` and checks each message event with `messageSchema`, ignoring anything else. After a stream ends, `EventSource` reconnects by itself, which the hook leaves alone for a stream that comes straight back. But `EventSource` gives up for good when a request gets an error status, and while the server is unreachable it keeps retrying at the short `retry` delay for as long as the outage lasts. So after a failed request, or a third reconnect error in a row with no `ready`, the hook closes it and opens a new one after a backoff: 1 s doubling to 30 s, each wait picked at random from its upper half, and back to 1 s once a stream is ready. The error count carries over to the new `EventSource`, so while the server stays unreachable each new one is handed back to the backoff on its first error. Each live message goes through `addMessage`. Every `ready`, the first included, runs `catchUp`:

- If the list has not loaded, or a fetch is in flight (the first one usually is, and it may predate the subscribe), it waits for that fetch, or starts one, without cancelling it.
- It then asks for `after=<the id 5 messages before the newest>&limit=100` (`CATCH_UP_OVERLAP`); with 5 messages or fewer, for the latest page.
- `mergeCaughtUp` puts the page in place of what the list held after that id, so missed messages land before live ones that arrived while the page loaded, and the server's order wins for a message that committed late.
- A full page of 100 may not reach the newest message; the list then reloads its latest page instead, since it only shows that page anyway. A failed catch-up request also reloads the list.

Because the trigger fires for every insert, messages posted through any instance reach every connected client.

### Swapping the real-time layer

Two interfaces keep the hub independent of where messages come from and how they reach the browser:

- **A new source** (Redis pub/sub, NATS) implements `MessageSource` (`start({ onMessage, onDisconnect, onReconnect })`, `stop()`) and is picked in `createMessageSource()`. The hub and routes do not change.
- **A new transport** (WebSockets, Socket.IO) wraps each connection as a `Subscriber` (`send`, `close`, and `heartbeat` only if it has no keepalive of its own) and calls `getRealtimeHub().subscribe`. Routes depend on the `RealtimeHub` interface, not the class. Socket.IO brings its own rooms and multi-instance adapters, so with it the hub would shrink to forwarding the source to `io.to(roomId)`.
- **Supabase Realtime (v2)** replaces both: the browser subscribes directly, and no hub runs on our server. The seam that matters there is the client hook `useRoomStream` (T4.2), whose catch-up (refetch with `after=`, de-duplicate by id) is the same for any transport.

## Deployment

On the `v2` branch the Dockerfile, Compose and the migration runner are gone (v2 Task 1); this section describes v1, as on `main`, until v2's Vercel deployment replaces it. Migrations live in `supabase/migrations/` and are applied with the Supabase CLI.

**The image.** The `Dockerfile` builds Next's standalone server (`output: "standalone"`, turned on by `DOCKER_BUILD` so that `next start` does not warn about it elsewhere), runs as the non-root `node` user, and needs only `DATABASE_URL` at run time; the optional `RATE_LIMIT_*` are read at run time too, and Compose passes them on. `NEXT_PUBLIC_MAP_*` are build args, since they are inlined into client code. `docker compose --profile app up --build` runs it with the database; the profile leaves `docker compose up -d db` starting only the database. It does not yet contain the RDS CA bundle, which `INFRA.md` lists as needed before a first deploy.

**Migrations** are a separate command in the same image (`node scripts/migrate.mts`, Compose's `migrate` service), not part of starting the app, so a deployment runs them once and before the new instances.

**`/health`** runs `select 1` through `ChatRepository.ping()`, with a 2 s limit because the pool waits with no limit for a connection. The reason for a failure goes to the log only. Use it for readiness, to stop sending traffic to an instance that cannot reach the database, and not to restart instances: a database outage would restart every one of them, for nothing, since each recovers by itself (Real-time delivery). For that reason the image has no `HEALTHCHECK`, which platforms such as Swarm act on with restarts; Compose sets its own, for `--wait`, and does not restart on it. ECS replaces any task that fails its load balancer check, so readiness in this sense is not available there: on ECS the ALB checks `/favicon.ico`, and `/health` is for post-deploy checks and monitoring (see `INFRA.md`). The route calls `connection()` because it reads nothing from the request, and `next build` would otherwise run it and log a failed check.

**Shutdown.** Next answers SIGTERM and SIGINT with `server.close()` and waits for every request to finish. A stream never finishes, so measured under the production image, one open stream held the process until Docker killed it (exit 137). `closeStreamsOnShutdown` (`src/server/realtime/shutdown.ts`, registered in `src/instrumentation.ts`) therefore calls `stopRealtimeHub()` on the signal. With only raw streams open, Next then exits by itself in about 0.15 s. A client on a keep-alive connection is different. `server.close()` leaves a connection open if it was busy at the signal, so once its stream ends, the connection alone still delays exit (measured with nothing reconnecting: the stream ended at once, and the stop took 2.2 s). A browser's `EventSource` goes further and reopens its stream over that connection, which gets `ready` from a new hub and `LISTEN` on the dying instance. So the process exits by itself 2 s after the signal (`SHUTDOWN_DEADLINE_MS`) if Next has not by then, which also leaves requests in flight time to finish. That exit is the normal path for an instance with a browser connected: measured, 2.2 s and exit 143. A browser therefore moves to another instance only after that one more connection to this one; it then catches up, with messages posted meanwhile arriving once and in order. The deadline is short because a plain `docker stop` was measured killing the process after about 3 s (Docker 29). CI's `docker` job checks `/health` and runs `scripts/check-docker-shutdown.sh`, which fails if either the stop or the deadline is removed: a stream that does not reconnect must end within 1.5 s, and one that reopens on its connection must end within 5 s, both with exit 143. On `v2` that job and script are gone with the Dockerfile, so until Task 3 removes the stream and its shutdown handling, only the unit tests in `src/server/realtime/shutdown.test.ts` check it.

## Testing approach

- **Unit**: zod schemas, clustering grid math, repository and SQL functions against the local Supabase database (including bounds that cross the antimeridian).
- **API**: route handlers against the local Supabase stack, through its API as on v2 in production.
- **Which database:** unit, API and e2e tests all use the local stack's one database (`SUPABASE_DB_URL`) and empty it, so they wipe dev data and must not run at the same time. Each suite first refuses any URL whose host is not `127.0.0.1` or `localhost` (`assertLocalDatabase`), so a `.env` pointing at the hosted project cannot be emptied, then applies migrations written since the stack started.
- **E2E (Playwright)**: drop a draft that saves nothing, create the room with its first message, reload and see persistence; move, discard and double-click a draft; a second browser sees a posted message live; after the stream fails for a while, messages sent meanwhile appear once and in order; and after the app's `LISTEN` connection is terminated in Postgres (`dropRealtimeListener`), an open stream reconnects and catches up once, in order. Playwright starts its own dev server on port 3100 (`E2E_PORT`), never `npm run dev` on 3000, and fails if that port is busy unless `E2E_REUSE_SERVER=1`, so it cannot silently test another checkout's server. The server and the tests read the Supabase settings from the environment or `.env`, and global setup empties the `SUPABASE_DB_URL` database once per run, so tests must not depend on each other's rooms. Because tests share that database and click the same spots, a fixture (`ownRoomsOnly`, on by default) answers each page's viewport requests with only the rooms that page created; viewport tests turn it off and never rely on an area being empty. Shared locators and actions live in `e2e/chat-page.ts`. `rooms.spec.ts` stays one file on purpose: its tests wait on click timers and map animations, which run late under CPU load, and as one file they run one at a time. Split into three files that ran in parallel, a few failed in most full runs.

## Known limitations (documented, not built)

- New rooms created by other users appear only when the map fetches a viewport: on moving to an area or zoom with no fresh cached result, or when the window regains focus (real-time covers messages only).
- Clustering is grid-based over a plain `(lat, lng)` index. PostGIS with a GiST index is the next step at larger scale.
- When a viewport has more than 500 occupied cells, the sparsest are dropped, so the shown counts can add up to fewer rooms than are in view. Merging the remainder into coarser clusters would fix it.
- No authentication, so authorship is self-declared.
- Zooming during a flight works from the flight's mid-air zoom, so zooming in can end a level further out than where the user started. The zoom is still whole, and one more step corrects it.
- `rooms.message_count`, its trigger, and the API's `messageCount` field are kept up to date, but the UI does not use them for now. They stay in case a later version needs them.
- A page opened on a room shows the default view until the room has loaded, and asks for that view's pins. On a slow connection, a user who drags in that moment is moved to the room once it arrives.
- `POST /api/rooms` still accepts a room with no first message, so a direct API call can add an empty room to the map, within the rate limit. The app itself never does.
- Rooms cannot be deleted, so empty rooms created by earlier versions stay on the map.
- A draft is lost on reload, along with any text typed in it. Back from a draft started on the first page of a visit leaves the site, losing it the same way; the draft adds no history entry of its own there, and adding one needs a redesign of how drafts use history.
- The on-screen keyboard is not covered by tests, because Playwright cannot simulate it. Phone browsers do not resize the page for it by default and scroll the focused field into view instead, so a phone on its side may show only the form while typing.
- A room shows only its latest 50 messages; there is no "load older" yet, though the API's `before` cursor supports it.
- A refetch replaces the list with the latest 50 messages, so with 50 loaded plus 5 live, a reader at the very top who refocuses the tab loses the five oldest and the view starts at the sixth. Readers further down keep their place in Chromium through scroll anchoring; Safari, which has none, was not tested. Merging the refetch would have to avoid a silent gap after a long time offline, so it was left out. Add a test when browsers other than Chromium are configured.
- A first message that fails after the user went Back and Forward during the send ends the draft with no message saying the room was not created, and anything typed into the form shown meanwhile is lost. A short status line would explain it.
- (v1) `/health` shares the app's connection pool, so it also answers 503 when the pool is saturated, for example by requests waiting on a long lock, though the database still answers others. All instances would go unready together. A ping that times out is not cancelled, and keeps its connection until the database answers; the pool recovers by itself. A dedicated short-lived connection would avoid both.
- The stream's backlog limit assumes the queue can drain between writes. Notifications that arrive together are delivered with no chance to drain, so one transaction inserting 5000 rows dropped a client that was reading, after 43 messages, and the log says it "stopped reading". 200 rows arrived in full. The app inserts one row per transaction, so this takes bulk SQL; the client should reconnect and catch up as after any drop.
- The 2 s shutdown deadline applies whatever time the platform would allow, so a request slower than that at shutdown, as during a database stall, is cut off with no response. Its message may or may not have been stored (both were seen), so a resend can duplicate it. Making the deadline configurable would help where the platform waits longer. On ECS behind the ALB (`INFRA.md`) this should matter less, because draining gives requests up to 30 s before the signal.
- Hooks and components are tested here without React Testing Library or jsdom, so code that needs a live React tree or a Leaflet map has no unit test, only e2e: `useRoomStream` (the effect, and closing the stream on unmount or a room change), `useFlyToRoom`, `ChatShell`, `LeafletMap` (`ClickToDraft`, `EnterToDraft`), `MapMarkers` and `MessageForm`. The pure logic they use is unit tested (`draftReducer`, `viewport`, `map-grid`, `message-cache`, `message-input`). Add hook and component tests if those tools are ever added (ask first: new dependencies).
- Basic per-IP rate limiting only. Counters are per instance, so N instances allow N times the limit, and a restart resets them; production adds a per-IP rule at the WAF (see `INFRA.md`), and a shared store such as Redis is the next step.
- Two rooms at exactly the same point never separate: below zoom 16 they form a cluster, and from zoom 16 their pins overlap, so the lower one should be unreachable by pointer, though Tab reaches it (positions measured, the click not tested). Enter drops a draft at the centre of the map, so the same default view and window size give the same point. Listing the rooms at a point would solve it.
- The pin's offset for the desktop card is applied only when the selection changes, so rotating a large phone across the 768 px line can leave the pin mostly off-screen until the map is moved (measured at 844x390 to 390x844). Re-centring would touch `useFlyToRoom`, whose timing has been the most fragile part of the map, for a small case.
- Six visible windows on a room still use all six HTTP/1.1 connections a browser allows per host, so a seventh window cannot load until one closes or is hidden. HTTP/2 at the load balancer should remove the limit, which was not tested.
- The client IP is trusted from `X-Forwarded-For`, so the app must sit behind a proxy that appends to it. Exposed directly, a client can set the header and pick a fresh key for every request.
- A fixed window lets one IP send up to twice the limit across a window boundary.
