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

- A stray click costs nothing: a room exists only once its first message is sent, and a draft can be moved or discarded.
- Username remembered between visits.
- Auto-scroll to the newest message, unless you have scrolled up to read; Submit disabled until both fields are filled.
- The map flies to the selected room.
- Selected room kept in the URL (`?room=<id>`), so a room can be shared and survives a refresh.
- After a dropped connection, the chat reconnects by itself and fills in the messages it missed.
- Keyboard use: Enter on the focused map drops a draft at its centre, and the arrow keys move the map first.
- A phone on its side shows the chat beside the map, so the form stays usable.
- Ready to deploy behind a proxy: a Docker image, a `/health` endpoint, and a clean shutdown with chats open.

## Tech stack

Next.js (App Router), TypeScript, Tailwind, react-leaflet (OpenStreetMap tiles), PostgreSQL, Zod, TanStack Query, Vitest, Playwright, Docker Compose.

## Prerequisites

- Docker, with Compose, for PostgreSQL.
- Node.js 26 or newer and npm, unless you run everything in Docker (below). `.nvmrc` pins the version used in CI, so `nvm use` picks it up.

No accounts or API keys are required.

## Run it locally

```bash
git clone https://github.com/andrei-cimpan/wolfchatter.git
cd wolfchatter
cp .env.example .env          # defaults work for local development
docker compose up -d db       # start PostgreSQL
npm install
npm run db:migrate            # create tables
npm run dev                   # http://localhost:3000
```

`npm install` reports a deprecated ESLint and moderate vulnerabilities. These come only from ESLint and its plugins, not from what the app ships (`npm audit --omit=dev` finds none). Do not run `npm audit fix --force`: it downgrades ESLint.

To see real-time delivery, open the app in two browser windows, open the same room in both, and post a message in one.

**Or run everything in Docker**, with no local Node.js and no `.env`. This builds the production image, applies the migrations, and serves the app at http://localhost:3000:

```bash
docker compose --profile app up --build
```

## Tests

Start the database first (`docker compose up -d db`), with `.env` in place as above. Tests never touch your development data: each kind creates and migrates its own database.

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
| `npm run db:migrate` | Apply SQL migrations |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit and API tests (needs the database running) |
| `npm run e2e` | Playwright end-to-end tests (needs the database running) |

## Configuration

All configuration is through environment variables. `.env.example` lists them all, with their defaults.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | Database used by `npm test`; created and migrated automatically, emptied between tests. Must end in `_test` |
| `E2E_DATABASE_URL` | Database used by `npm run e2e`; created and migrated automatically, emptied once per run. Must end in `_e2e` |
| `RATE_LIMIT_ROOMS_PER_MINUTE`, `RATE_LIMIT_MESSAGES_PER_MINUTE` | Optional per-IP limits on creating rooms and posting messages (defaults: 10 and 30) |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Optional basemap (default: OpenStreetMap). Read at build time |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `APP_PORT` | Optional overrides for `docker-compose.yml` |

## Project structure

```
src/app/             pages and API route handlers, including /health
src/components/      ChatShell, MapView, LeafletMap, MapMarkers, RoomPanel, MessageList, MessageForm
src/hooks/           data and real-time hooks
src/lib/             shared types, validation schemas
src/server/          repository (database access), real-time hub, HTTP helpers
db/migrations/       SQL migrations
e2e/                 Playwright tests
scripts/             migration runner, Docker shutdown check
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
- No authentication: usernames are self-declared. Basic per-IP rate limiting is the only abuse protection, and it needs a proxy that appends to `X-Forwarded-For`. Do not expose the Docker image directly: a client could set that header and escape the limit.
- A room shows only its latest 50 messages; there is no "load older" yet.
- Clustering is grid-based over a plain `(lat, lng)` index; PostGIS is the next step at larger scale.
- OpenStreetMap public tiles are for development and light use only.

## Roadmap (v2, separate branch)

v2 is a personal idea outside the brief: a smaller version for a small userbase, easy to deploy.

- Supabase for Postgres and Realtime, replacing the SSE hub behind the same `ChatRepository` interface.
- Supabase Auth: anyone can read, signed-in users post, enforced with row-level security.
- Mapbox via react-map-gl instead of OpenStreetMap tiles.
- Deployment to a simple host, for example Vercel.
