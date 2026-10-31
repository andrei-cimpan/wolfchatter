# Wolfchatter

A real-time chat app built on a map. Click the map to drop a pin and start a conversation for that place. Anyone can open a pin and join in.

## Features

- Click the map to create a pin and a chatroom; the panel switches to that room.
- Click an existing pin to open its room.
- Post messages with a username and a message. Rooms and messages are stored in PostgreSQL and survive restarts.
- Messages from other users appear in real time (Server-Sent Events).
- Pins load by map viewport and cluster when zoomed out, so the map stays fast with many rooms.
- Responsive layout: chat panel on the right on desktop, bottom sheet on small screens.

**Improvements beyond the brief**

- Username remembered between visits.
- Auto-scroll to the newest message; Submit disabled until both fields are filled.
- Message count on each pin; the map flies to the selected room.
- Selected room kept in the URL (`?room=<id>`), so a room can be shared and survives a refresh.

## Tech stack

Next.js (App Router), TypeScript, Tailwind, react-leaflet (OpenStreetMap tiles), PostgreSQL, Zod, TanStack Query, Vitest, Playwright, Docker Compose.

## Run it locally

You need Node.js 26 or newer and Docker. No accounts or API keys are required.

```bash
git clone <repo-url> wolfchatter
cd wolfchatter
cp .env.example .env          # defaults work for local development
docker compose up -d db       # start PostgreSQL
npm install
npm run db:migrate            # create tables
npm run dev                   # http://localhost:3000
```

To see real-time delivery, open the app in two browser windows, open the same room in both, and post a message in one.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit and API tests (needs the database running) |
| `npm run e2e` | Playwright end-to-end tests |

## Configuration

All configuration is through environment variables. See `.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |

## Project structure

```
src/app/             pages and API route handlers
src/components/      MapView, RoomPanel, MessageList, MessageForm
src/hooks/           data and real-time hooks
src/lib/             shared types, validation schemas
src/server/          repository (database access) and real-time hub
db/migrations/       SQL migrations
docs/                PRD, design, tasks, infrastructure, review
.claude/             AI review skill
CLAUDE.md            standing instructions for AI tooling
```

## Documentation

- [Technical PRD](docs/PRD.md): requirements and technical decisions.
- [Design note](docs/DESIGN.md): architecture, schema, API, real-time flow.
- [Task list](docs/TASKS.md): the build plan, ticked off as it was done.
- [Infrastructure and cost estimate](docs/INFRA.md): AWS deployment plan for staging and production.
- [Code review report](docs/REVIEW.md): the self-review and what was fixed or left.

## How I worked with AI

The project was built docs-first with Claude.

1. The PRD, design note, and task list were written before any code and committed first.
2. `CLAUDE.md` gives the AI tooling the stack, commands, architecture rules, and a working loop: one task at a time, a plan before multi-file changes, tests with every change, and small conventional commits.
3. Every task in `docs/TASKS.md` has an acceptance check, and a task counts as done only when lint, typecheck, and tests pass.
4. The code was reviewed with a dedicated skill (`.claude/skills/code-review/`), run in a fresh session against the final code. The report is in `docs/REVIEW.md`, together with a note on what I fixed and what I chose not to fix.

## Known limitations

- Rooms created by other users appear after the next pan or zoom. Real-time covers messages only.
- No authentication: usernames are self-declared. Basic per-IP rate limiting is the only abuse protection.
- Clustering is grid-based over a plain `(lat, lng)` index; PostGIS is the next step at larger scale.
- OpenStreetMap public tiles are for development and light use only.

## Roadmap (v2, separate branch)

- Supabase for Postgres, Realtime, and Auth: anyone can read, signed-in users post.
- Mapbox instead of OpenStreetMap tiles.
- Deployment to AWS, following `docs/INFRA.md`.
