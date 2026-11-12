# Wolfchatter

A real-time chat app built on a map. Click the map to drop a pin, and send the first message to start a conversation for that place. Anyone can open a pin and join in.

## Features

- Click the map to drop a draft pin, and send the first message to create the chatroom. Until then nothing is saved, and the panel says so.
- Double-click the map to zoom in.
- Click an existing pin to open its room.
- Post messages with a username and a message. Rooms and messages are stored in PostgreSQL and survive restarts.
- Messages from other users appear in real time (Server-Sent Events).
- Pins load by map viewport and cluster when zoomed out, so the map stays fast with many rooms.
- Responsive layout: chat panel on the right on desktop, bottom sheet on small screens.

**Improvements beyond the brief**

- A stray click costs nothing: a room exists only once its first message is sent, and a draft can be moved or discarded. This differs from mockup 3 on purpose: a second click moves the draft, and a second pin appears once the first room has its message.
- Username remembered between visits.
- Auto-scroll to the newest message, unless you have scrolled up to read; Submit disabled until both fields are filled.
- The map flies to the selected room.
- Selected room kept in the URL (`?room=<id>`), so a room can be shared and survives a refresh.
- After a dropped connection, the chat reconnects by itself and fills in the messages it missed.
- Keyboard use: Enter on the focused map drops a draft at its centre, and the arrow keys move the map first.
- A phone on its side shows the chat beside the map, so the form stays usable.
- A `/health` endpoint, and a clean shutdown with chats open.

## Tech stack

Next.js (App Router), TypeScript, Tailwind, react-leaflet (OpenStreetMap tiles), PostgreSQL, Zod, TanStack Query, Vitest, Playwright, Supabase (`@supabase/supabase-js` and `@supabase/ssr`, and the Supabase CLI for the local stack).

## Prerequisites

- Docker, which the Supabase CLI uses to run the local stack (PostgreSQL and the Supabase services).
- Node.js 26 or newer and npm. `.nvmrc` pins the version used in CI, so `nvm use` picks it up.

No accounts or API keys are required.

## Run it locally

```bash
git clone https://github.com/andrei-cimpan/wolfchatter.git
cd wolfchatter
cp .env.example .env          # defaults work for local development
npm install
npm run db:start              # start local Supabase and create the tables; the first run pulls images
npm run dev                   # http://localhost:3000
```

`npm install` reports a deprecated ESLint and moderate vulnerabilities. These come only from ESLint and its plugins, not from what the app ships (`npm audit --omit=dev` finds none). Do not run `npm audit fix --force`: it downgrades ESLint.

To see real-time delivery, open the app in two browser windows, open the same room in both, and post a message in one.

## Tests

Start the local stack first (`npm run db:start`), with `.env` in place as above. Both test suites use the local Supabase database and empty it, so they wipe what `npm run dev` stored there, and they must not run at the same time. They refuse any database that is not on this machine.

```bash
npm run lint
npm run typecheck
npm test                             # unit and API tests

npx playwright install chromium      # once, to download the browser
npm run e2e                          # end-to-end tests
```

`npm run e2e` starts its own server on port 3100, and fails if that port is busy.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run build`, `npm start` | Build the app and serve the production build |
| `npm run db:start` | Start the local Supabase stack and apply its migrations |
| `npm run db:migrate` | Apply migrations written since the stack started |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit and API tests (needs the database running) |
| `npm run e2e` | Playwright end-to-end tests (needs the database running) |

## Configuration

All configuration is through environment variables. `.env.example` lists them all, with their defaults.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The Supabase project the app reads and writes through, and the browser subscribes to for live messages. Required: `next dev`, `next build` and `npm run typecheck` (through `next typegen`) stop without them |
| `SUPABASE_DB_URL` | The local Supabase database, which `npm test` and `npm run e2e` use and empty. Must be on `127.0.0.1` or `localhost`. The app itself does not read it |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Optional basemap (default: OpenStreetMap). Read at build time |

## Project structure

```
src/app/             pages and API route handlers, including /health
src/components/      ChatShell, MapView, LeafletMap, MapMarkers, RoomPanel, MessageList, MessageForm
src/hooks/           data and real-time hooks
src/lib/             shared types, validation schemas, Supabase config and live subscription
src/server/          repository (database access), HTTP helpers
supabase/            local stack config and SQL migrations
e2e/                 Playwright tests
docs/                PRD, design, tasks, infrastructure, review
.claude/             AI review skill
CLAUDE.md            standing instructions for AI tooling
```

## Documentation

- [Technical PRD](docs/PRD.md): requirements and technical decisions.
- [Design note](docs/DESIGN.md): architecture, schema, API, real-time flow, deployment.
- [Task list](docs/TASKS.md): the build plan, ticked off as it was done.
- [Infrastructure and cost estimate](docs/INFRA.md): AWS deployment plan for staging and production.
- [Code review report](docs/REVIEW.md): the self-review and what was fixed or left.

## How I worked with AI

The project was built docs-first with Claude.

1. The PRD, design note, and task list were written before any code and committed first.
2. `CLAUDE.md` gives the AI tooling the stack, commands, architecture rules, and a working loop: one task at a time, a plan before multi-file changes, tests with every change, and small conventional commits.
3. A task in `docs/TASKS.md` counts as done only when lint, typecheck, and tests pass, plus its acceptance check where it has one. From T1 on, each task got its own branch and pull request, and I merged them myself.
4. Pull requests were reviewed by a fresh AI agent that had not written the code. Its main findings were reproduced before I decided what to fix. What was left open is recorded in `docs/TASKS.md` or in Known limitations in `docs/DESIGN.md`.
5. The final code was reviewed with a dedicated skill (`.claude/skills/code-review/`), run by a fresh AI agent that had not written the code. Its main findings were reproduced before I decided what to fix. The report is in `docs/REVIEW.md`, together with a note on what I fixed and what I chose not to fix.

## Known limitations

The main ones are below. The full list is in [the design note](docs/DESIGN.md#known-limitations-documented-not-built).

- Rooms created by other users appear only when the map next fetches that area: on moving to an area or zoom it has no fresh result for, or when the window regains focus. Real-time covers messages only.
- No authentication: usernames are self-declared. Basic per-IP rate limiting is the only abuse protection, and it needs a proxy that appends to `X-Forwarded-For`. Do not expose the app directly: a client could set that header and escape the limit.
- A room shows only its latest 50 messages; there is no "load older" yet.
- Clustering is grid-based over a plain `(lat, lng)` index; PostGIS is the next step at larger scale.
- OpenStreetMap public tiles are for development and light use only.

## Roadmap (v2, separate branch)

v2 is a personal idea outside the brief: a smaller version for a small userbase, easy to deploy.

- Supabase for Postgres and Realtime, replacing the SSE hub; the `ChatRepository` interface stays.
- Supabase Auth: anyone can read, signed-in users post, enforced with row-level security.
- Mapbox via react-map-gl instead of OpenStreetMap tiles.
- Deployment to a simple host, for example Vercel.
