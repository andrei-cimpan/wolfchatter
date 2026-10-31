# Wolfchatter: Task List (v1)

Work top to bottom, one task at a time. A task is done when its acceptance check passes and `lint`, `typecheck`, and `test` are green. Tick the box in the same commit.

## 0. Foundation

- [x] **T0.1** Create the repo, scaffold Next.js (TypeScript, Tailwind, ESLint), commit `CLAUDE.md` and `docs/`.
  *Check:* `npm run dev` shows the default page.
- [x] **T0.2** Add Docker Compose with Postgres, `.env.example`, and a migration runner (`npm run db:migrate`).
  *Check:* `docker compose up -d db && npm run db:migrate` succeeds on a clean machine.
- [x] **T0.3** Add Vitest, Playwright, and a GitHub Actions workflow running lint, typecheck, and tests.
  *Check:* CI passes on a trivial test.

## 1. Data layer

- [x] **T1.1** Write the initial migration from `DESIGN.md`.
  *Check:* tables, indexes, and trigger exist.
- [x] **T1.2** Implement `ChatRepository` and `PostgresChatRepository` with tests.
  *Check:* create room, post message, list with `before` and `after` paging, and `listMapItems` returns rooms and clusters correctly (including bounds that cross the antimeridian).
- [ ] **T1.3** Add Zod schemas for room and message input, with shared types.
  *Check:* invalid lat/lng, empty or over-long author/body are rejected.

## 2. API

- [ ] **T2.1** `GET /api/rooms?bbox=&zoom=` (viewport loading with grid clustering, capped at 500 items), `POST /api/rooms`, and `GET /api/rooms/:id`, with error shape and validation.
- [ ] **T2.2** `GET/POST /api/rooms/:id/messages` with paging and 404 handling.
- [ ] **T2.3** Basic per-IP rate limiting on POST routes.
  *Check (all):* API tests cover success, 400, 404, and 429.

## 3. Core UI

- [ ] **T3.1** Responsive layout with Leaflet map and chat panel (right column on desktop, bottom sheet on narrow screens); empty state "Click on the map to start a chat".
- [ ] **T3.2** Click map to create a room and pin; panel switches to it; selection stored in `?room`.
- [ ] **T3.3** Load pins for the current viewport (debounced on map move). Render rooms as markers and clusters as count bubbles. Clicking a marker switches the panel; clicking a cluster zooms in.
- [ ] **T3.4** Message list and form (username + message + Submit); posted messages appear.
- [ ] **T3.5** Reloading the page restores rooms, messages, and the selected room.
  *Check (all):* matches mockups 1 to 4.

## 4. Real-time

- [ ] **T4.1** Realtime hub: one `LISTEN`, in-memory fan-out, heartbeat.
- [ ] **T4.2** `GET /api/rooms/:id/stream` and the `useRoomStream` hook with reconnect catch-up.
  *Check:* a message posted in one browser appears in another within about a second, with no duplicates after a reconnect.

## 5. Usability improvements

- [ ] **T5.1** Remember the username in localStorage.
- [ ] **T5.2** Auto-scroll to the newest message; disable Submit when a field is empty.
- [ ] **T5.3** Message count on each marker; fly the map to the selected room.

## 6. Quality

- [ ] **T6.1** Playwright tests: create pin and post, reload persistence, two-browser live message, clusters appear when zoomed out and expand on click, and the bottom-sheet layout at a 375 px wide viewport.
- [ ] **T6.2** Dockerfile for the app and a `/health` endpoint.

## 7. Documents and review

- [ ] **T7.1** README: prerequisites, run locally, tests, improvements made, v2 plan.
- [ ] **T7.2** `docs/INFRA.md`: component, service, why, monthly cost for staging and production, with assumptions.
- [ ] **T7.3** Review skill in `.claude/`, run on the final code, commit `docs/REVIEW.md` (report) and the fixed/not-fixed note.
- [ ] **T7.4** Final check from a clean clone, then email the repo link before the deadline.

## 8. v2 (separate branch, only after v1 is complete)

- [ ] **T8.1** `SupabaseChatRepository` and Supabase Realtime replacing the SSE hub.
- [ ] **T8.2** Auth: public read, signed-in posting, row-level security.
- [ ] **T8.3** Mapbox via react-map-gl.
