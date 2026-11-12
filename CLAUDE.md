# Wolfchatter

Real-time chat on a map: click the map to drop a pin and open a chatroom for that place.

Read these before changing code:
- `docs/PRD.md`: what we build and why
- `docs/DESIGN.md`: how it is built
- `docs/TASKS.md`: what to do next

## Stack (v2 branch, in progress)

Next.js (App Router) · TypeScript (strict) · Tailwind · react-leaflet · PostgreSQL (local Supabase stack, Supabase CLI) · Zod · TanStack Query · Vitest · Playwright

## Commands

- `npm run db:start`: start the local Supabase stack (Docker), applying `supabase/migrations/`
- `npm run db:migrate`: apply migrations written since the stack started (`npx supabase db reset` rebuilds it)
- `npm run dev`: start the app at http://localhost:3000
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e`

## Architecture rules

- UI and route handlers use the `ChatRepository` interface only. Application code never imports the DB client outside `src/server/repositories/`; test setup (`src/server/repositories/test/`, `e2e/`) is the only exception.
- Validate every API input with Zod at the route boundary.
- Render user text as plain text. Never use `dangerouslySetInnerHTML`.
- Server state lives in TanStack Query. The selected room lives in the URL (`?room=<id>`). No global store.
- Config comes from environment variables. Never hardcode secrets. Commit `.env.example` only.

## Code style

- No `any`. Prefer small, single-purpose components and functions.
- Name files by what they contain: `RoomPanel.tsx`, `chat-repository.ts`.
- Comments explain why, not what.

## Workflow

1. Pick one task from `docs/TASKS.md`. Finish it before starting the next.
2. For anything touching more than 2 files, propose a short plan first.
3. Write tests with the code. A task is done only when `lint`, `typecheck`, and `test` pass.
4. Make small commits using Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`).
5. If a decision changes, update the relevant doc in the same commit.
6. Ask before adding a dependency or deviating from the PRD.

## Out of scope for v1 (`main`)

Auth, Supabase, and Mapbox. These belong to the v2 branch.
