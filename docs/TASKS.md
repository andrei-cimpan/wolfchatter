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

- [x] **T5.1** Remember the username in localStorage.
- [x] **T5.2** Auto-scroll to the newest message; disable Submit when a field is empty.
  *Still open from the PR #12 review:* any 400 becomes "Enter a username and a message.". The form checks with the API's own schema first, so this cannot be reached today; use the API's message if the client and API rules ever differ.
- [x] **T5.3** Fly the map to the selected room.
- [x] **T5.4** Keep the chat usable in a short sheet.
  *Carried over from the PR #17 review:* the raised sheet is half the screen and its form has a fixed height, so at 667x375 (a phone on its side) the message list is 0 px tall and Submit runs past the bottom of the screen, and at 320x568 the list is only 47 px. Done: the sheet is at least 320 px tall, and a phone on its side shows the chat beside the map.
- [x] **T5.5** Draft pins: a click drops a draft that saves nothing, and the first message creates the room. Double-clicking the map zooms in.
  *Check:* a stray click leaves nothing on the server, the draft says the room is created by its first message, and a double-click zooms and leaves no pin.

## 6. Quality

- [x] **T6.1** Playwright tests: create pin and post, reload persistence, two-browser live message, clusters appear when zoomed out and expand on click, and the bottom-sheet layout at a 375 px wide viewport.
  *Flaky e2e tests seen on PR #19:*
  - Done: `a flight started during a zoom animation still ends on a whole zoom when dragged` was a real bug. A button's zoom starts a frame after its click, so its `zoomstart` could clear the zoom of a flight begun in between, and a drag then left the map between levels. A test now forces that order.
  - Done: `a second click makes a second room; pins and Back switch between them`, `Back flies to the previous room`, and `two rooms created in quick succession keep the zoom` fit one cause, not reproduced: the old `createRoomAt` could read the previous room's title. T5.5's helper waits for the draft first. With the zoom fix, these three and the test above passed 800 of 800 runs (200 each, 12 workers).
  *Carried over from the PR #20 review:*
  - Done: a first message that fails after Back and Forward ends the draft, with no error above an empty form. A failure after Back alone never showed one, since Forward ends the draft.
  - Done: Enter on the focused map drops a draft, so keyboard-only users can start a room. There is no visible hint for sighted keyboard users yet.
  - Moved to T7.4: trying double-tap, and a first message with the keyboard open, on a real phone.
  *Carried over from the PR #19 review:* done: tests at the layout's boundaries and for the desktop card in a quiet room, and the card now clears the notch.
  *Carried over from the PR #18 review:* done: no viewport request for a zoom a flight is only passing, tested on a narrow screen.
  *Not built, see Known limitations in `DESIGN.md`:* merging a refetch into the cached list (PR #17 review) and a unit test for `useRoomStream` (PR #15 review).
- [x] **T6.2** Dockerfile for the app and a `/health` endpoint.
  *Carried over from T4.2:* done: `stopRealtimeHub()` runs on SIGTERM and SIGINT. Next does not exit straight away, as this note used to say: it waits for every request, so one open stream held the process until Docker killed it. See Deployment in `DESIGN.md`.
  *Carried over from the PR #15 review:* done: a stream ends past 256 queued writes. Next does read the body with backpressure, measured under the production server.
  *Not fixed from the PR #22 review, see Known limitations in `DESIGN.md`:* `/health` shares the app's pool; a bulk insert can trip the backlog limit; the shutdown deadline cuts off slow requests.

## 7. Documents and review

- [ ] **T7.1** README: prerequisites, run locally, tests, improvements made, v2 plan.
- [ ] **T7.2** `docs/INFRA.md`: component, service, why, monthly cost for staging and production, with assumptions.
- [ ] **T7.3** Review skill in `.claude/`, run on the final code, commit `docs/REVIEW.md` (report) and the fixed/not-fixed note.
  *Carried over from the PR #21 review:*
  - A failed first message after Back and Forward says nothing to the user; see Known limitations in `DESIGN.md`. Kept for now, since Back already discards a draft's text.
  - `flightDragged` in `useFlyToRoom` stays true after a drag until the next flight, so a sheet resizing the map during a pinch could call `setZoom` mid-gesture. From reading only, not reproduced; it targets the zoom the pinch would snap to anyway. Clearing the flag once its `moveend` is handled would remove the case.
- [ ] **T7.4** Final check from a clean clone, then email the repo link before the deadline.
  *Moved from T6.1, needs a real phone:* double-tap the map, which is tested only with dispatched events, and send a first message with the keyboard open.

## 8. v2 (separate branch, only after v1 is complete)

- [ ] **T8.1** `SupabaseChatRepository` and Supabase Realtime replacing the SSE hub.
- [ ] **T8.2** Auth: public read, signed-in posting, row-level security.
- [ ] **T8.3** Mapbox via react-map-gl.
