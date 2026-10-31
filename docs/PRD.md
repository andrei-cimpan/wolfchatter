# Wolfchatter: Technical PRD

Draft v0.1 · 31 Oct 2026 · Status: pre-build

## 1. Overview

Wolfchatter is a real-time chat app built on a map. A user clicks the map to drop a pin, which creates a chatroom anchored to that place. Anyone can open a pin and talk in its room. This PRD is the starting context for the build and for the AI tooling used to build it.

## 2. Scope and versions

| Version | Goal | Notes |
|---|---|---|
| **v1** (main branch) | Complete test requirements, runs locally with no keys or accounts | Leaflet, Postgres via Docker Compose, Next.js |
| **v2** (separate branch) | Production-oriented evolution | Supabase (Postgres, Realtime, Auth), Mapbox, signed-in posting |

v1 must be fully submittable on its own. v2 is built only after v1 is complete.

## 3. Functional requirements (v1)

- **FR1** The initial view is an empty map with the message "Click on the map to start a chat".
- **FR2** Clicking the map creates a pin and a chatroom, and the right-hand panel switches to that room.
- **FR3** Clicking an existing pin switches the panel to that room (title and messages).
- **FR4** In a room, the user enters a username and a message and submits. The message appears in the room with author and timestamp.
- **FR5** Rooms and messages persist across sessions.
- **FR6** Messages from other users appear in real time without a refresh.
- **FR7** Pins load by map viewport. Zoomed out, nearby rooms collapse into clusters that show a count, and clicking a cluster zooms in.
- **FR8** The layout is responsive. On desktop the chat panel sits on the right of the map. On narrow screens it becomes a bottom sheet over the map.

**Usability improvements (beyond the brief):** remember the username locally, auto-scroll to the newest message, disable Submit when a field is empty, show a message count on each pin, and fly the map to the selected pin.

## 4. Technical decisions

**Stack.** Next.js (App Router) with TypeScript and Tailwind. react-leaflet with the default OpenStreetMap tiles, kept behind a config so the basemap is swappable. Zod for input validation.

**Cloud-portable by design.** Dockerfile for the app, `docker compose up` for local Postgres, all config via environment variables, a stateless app, logs to stdout, and a `/health` endpoint. The deployment target is described in `INFRA.md`.

**Data model (Postgres).**

| Table | Columns |
|---|---|
| `rooms` | `id` uuid PK, `title` text, `lat` double, `lng` double, `created_at` timestamptz |
| `messages` | `id` uuid PK, `room_id` FK, `author` text (max 32), `body` text (max 1000), `created_at` timestamptz |

Indexes: `messages (room_id, created_at)` and `rooms (lat, lng)`. Room titles default to "Chatroom N", as in the mockups.

**Viewport loading and clustering.** The map requests only the pins in view (`bbox` and `zoom`). The server groups rooms into grid cells of roughly 64 px at that zoom and returns one cluster (count and centre) per crowded cell, and individual rooms elsewhere. At zoom 16 and above rooms are never clustered. Each room also keeps a denormalized `message_count` for the pin badge.

**Data access abstraction.** The UI and API handlers depend only on a `ChatRepository` interface (`listRooms`, `createRoom`, `listMessages`, `postMessage`, `subscribe`). v1 provides `PostgresRepository`. v2 adds `SupabaseRepository` without changing UI code.

**API (REST, JSON).**

- `GET /api/rooms?bbox=<w,s,e,n>&zoom=<z>`: rooms and clusters inside the viewport
- `POST /api/rooms` and `GET /api/rooms/:id`
- `GET /api/rooms/:id/messages?before=<cursor>&after=<cursor>` and `POST /api/rooms/:id/messages`
- `GET /api/rooms/:id/stream` (Server-Sent Events, FR6)

**Real-time delivery.** Server-Sent Events from the Next.js server, fed by Postgres `LISTEN/NOTIFY` so it works across multiple app instances. If the connection drops, the client reconnects automatically and refetches any missed messages. In v2 this is replaced by Supabase Realtime.

**State management.** Server state (rooms, messages) with TanStack Query. The selected room lives in the URL (`?room=<id>`), so it is shareable and survives refresh. The username is kept in localStorage. No global store is needed.

**Security (v1, no auth).** Text is rendered as plain text, never as HTML. Inputs are validated and length-limited. Basic per-IP rate limiting on POST routes.

**Testing.** Vitest for unit and API tests, and Playwright end-to-end tests (create a pin, post a message, reload, see persistence; and a two-browser check that a message appears live).

## 5. Scale assumptions

The brief gives no load figures. Assumed: ~50k monthly users at launch, with a design ceiling of millions. v1 builds viewport loading and clustering from the start and documents the rest of the path:

- Move spatial queries to PostGIS with a GiST index once the plain (lat, lng) index and grid clustering stop being fast enough.
- Paginate messages with cursors, and add PostGIS if spatial queries are needed.
- Move to a paid tile provider, since public OSM tiles are not meant for production traffic.
- Scale real-time with a dedicated WebSocket layer and Redis pub/sub.

## 6. v2 roadmap

- Supabase for Postgres, Realtime, and Auth. Row-level security: anyone can read; inserts require a signed-in user where `user_id = auth.uid()`.
- Mapbox via react-map-gl.
- Deployment to a cloud environment (staging and production), per `INFRA.md`.

## 7. Working with AI

Docs-first: this PRD, a design note, and a task list live in `docs/`. `CLAUDE.md` holds the stack, commands, and conventions. Work proceeds in small tasks, each with tests and a human-reviewed diff. A review skill (in `.claude/`) runs against the final code, with its report committed to the repo.
