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
- [x] **T1.3** Add Zod schemas for room and message input, with shared types.
  *Check:* invalid lat/lng, empty or over-long author/body are rejected; a bbox with unwrapped longitudes (for example `170,190`) is wrapped to ±180; non-finite bbox values, zoom, and limit are rejected.

## 2. API

- [x] **T2.1** `GET /api/rooms?bbox=&zoom=` (viewport loading with grid clustering, capped at 500 items), `POST /api/rooms`, and `GET /api/rooms/:id`, with error shape and validation.
  *Carried over from the PR #4 review:*
  - One shared mapper from Zod issues to `{ "error": { "code", "message" } }` with readable messages, plus one helper that turns `URLSearchParams` into schema input. Decide and test how empty values (`?before=&limit=`) and repeated keys are handled.
  - Reject author or body text that is only invisible characters (for example U+200B, U+0085), which JavaScript `trim()` keeps and which would render as a blank message.
- [x] **T2.2** `GET/POST /api/rooms/:id/messages` with paging and 404 handling.
  *Carried over from the PR #6 review:*
  - A few rare characters that draw nothing still pass the "visible text" rule on their own (U+FFF9 to U+FFFB, U+13430 to U+1343F, U+16FE4). Add them explicitly; don't add all of `\p{Cf}`, which would also reject visible Arabic signs (U+0600 to U+0605).
- [x] **T2.3** Basic per-IP rate limiting on POST routes.
  *Carried over from the PR #6 review:*
  - Require `Content-Type: application/json` on POST routes (415 `unsupported_media_type`). Without it, a cross-site `<form enctype="text/plain">` can post from visitors' browsers with no CORS preflight, spreading requests across their IPs and around the per-IP limit.
  *Check (all):* API tests cover success, 400, 404, and 429.

## 3. Core UI

- [x] **T3.1** Responsive layout with Leaflet map and chat panel (floating card on the right on desktop, bottom sheet on narrow screens); empty state "Click on the map to start a chat".
- [x] **T3.2** Click map to create a room and pin; panel switches to it; selection stored in `?room`.
- [x] **T3.3** Load pins for the current viewport (debounced on map move). Render rooms as markers and clusters as count bubbles. Clicking a marker switches the panel; clicking a cluster zooms in.
- [x] **T3.4** Message list and form (username + message + Submit); posted messages appear.
- [x] **T3.5** Reloading the page restores rooms, messages, and the selected room.
  *Check (all):* matches mockups 1 to 4.

## 4. Real-time

- [x] **T4.1** Realtime hub: one `LISTEN`, in-memory fan-out, heartbeat.
- [x] **T4.2** `GET /api/rooms/:id/stream` and the `useRoomStream` hook with reconnect catch-up.
  *Check:* a message posted in one browser appears in another within about a second, with no duplicates after a reconnect.
  *Carried over from the PR #14 review:*
  - Done: if the request aborts while `subscribe` is still waiting, the route calls the returned unsubscribe once it resolves.
  - Done: the route ends the stream if `subscribe` has not resolved after 10 seconds, and the browser retries.
  - Moved to T6.2: wiring `stopRealtimeHub()` to shutdown.

## 5. Usability improvements

- [ ] **T5.1** Remember the username in localStorage.
- [ ] **T5.2** Auto-scroll to the newest message; disable Submit when a field is empty.
  *Carried over from the PR #12 review:*
  - T3.4 already scrolls the list to the newest message on opening a room and whenever one is added. What is left is to stay put when the reader has scrolled up to older messages and a live one arrives (T4.2).
  - Submit is `disabled` while a post is sending, which can drop keyboard focus from the button. It was not reproduced in Chromium; once Submit is also disabled for empty fields, check focus after a failed post, or use `aria-disabled`, since the ref already blocks a second submit.
  - `messageInputError` maps every schema issue to "Enter a username." or "Enter a message.", and any 400 becomes "Enter a username and a message.". Neither path can be reached today, but use the issue's own message if the client and API rules ever differ.
- [ ] **T5.3** Message count on each marker; fly the map to the selected room.
  *Carried over from T3.2:* on narrow screens, a room created near the bottom of the map ends up behind the raised sheet. Flying to the selected room should keep its pin in the part of the map left visible.
  *Carried over from T3.5:* after a reload or on opening a `?room` link, the map starts on its default view, not on the selected room. Fly (or start) there on the first load too.
  *Carried over from the PR #11 review:* viewport cache keys keep Leaflet's unwrapped longitudes, so panning a full turn around the world refetches an area that is already cached. Shift `west` and `east` by the same whole number of turns into [-180, 180) before building the key (`viewportQuery` or `mapItemsQueryKey`), as flying to a room can also land on another copy of the world.

## 6. Quality

- [ ] **T6.1** Playwright tests: create pin and post, reload persistence, two-browser live message, clusters appear when zoomed out and expand on click, and the bottom-sheet layout at a 375 px wide viewport.
  *Carried over from the PR #15 review:* `useRoomStream` itself (the effect, and closing the stream on unmount or a room change) has no unit test, because hooks are tested here without React Testing Library or jsdom. The e2e tests cover it; add a hook test if those tools are ever added (ask first: new dependencies).
- [ ] **T6.2** Dockerfile for the app and a `/health` endpoint.
  *Carried over from T4.2:* nothing calls `stopRealtimeHub()` yet. Wire it to shutdown if the deployment needs open streams closed (so clients move to another instance) before the process exits; `next start` exits on SIGTERM without waiting for async handlers, so check what actually reaches the clients.
  *Carried over from the PR #15 review:* the stream writes with `controller.enqueue` without checking `desiredSize`, so for a client whose connection has stalled (a backgrounded phone, a NAT that forgot it) messages pile up in server memory until TCP gives up. Ending the stream past a small backlog would let the client reconnect and catch up, but first check that Next reads the body with backpressure (otherwise the backlog sits in the socket buffer and `desiredSize` never drops), under the production server.

## 7. Documents and review

- [ ] **T7.1** README: prerequisites, run locally, tests, improvements made, v2 plan.
- [ ] **T7.2** `docs/INFRA.md`: component, service, why, monthly cost for staging and production, with assumptions.
- [ ] **T7.3** Review skill in `.claude/`, run on the final code, commit `docs/REVIEW.md` (report) and the fixed/not-fixed note.
- [ ] **T7.4** Final check from a clean clone, then email the repo link before the deadline.

## 8. v2 (separate branch, only after v1 is complete)

- [ ] **T8.1** `SupabaseChatRepository` and Supabase Realtime replacing the SSE hub.
- [ ] **T8.2** Auth: public read, signed-in posting, row-level security.
- [ ] **T8.3** Mapbox via react-map-gl.
