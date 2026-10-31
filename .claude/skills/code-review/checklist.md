# Review checklist

Work through each category. Report only real findings.

## 1. Correctness

- Creating a room stores the clicked lat/lng exactly, and the panel switches to it.
- Clicking a marker selects the right room; `?room=<id>` restores it on reload, even when the pin is outside the viewport.
- Messages are ordered correctly and paging with `before` / `after` never skips or repeats a message.
- Viewport query: bounds that cross the antimeridian, zoomed-out world views, and bounds beyond +/-180 or +/-90 are handled.
- Cluster math: a cell with one room returns the room, not a cluster of 1; counts add up to the number of rooms in view; no clustering at zoom 16 and above; the 500-item cap behaves sensibly.
- `message_count` stays correct after posts.
- Empty and whitespace-only username or message cannot be submitted, on the client and on the server.

## 2. Real-time

- A message posted in one browser reaches another within about a second.
- On reconnect the client catches up with `after=` and does not show duplicates.
- SSE connections are cleaned up when the client disconnects (no leaked listeners or memory growth).
- The `LISTEN` connection recovers if Postgres restarts.
- Messages only reach clients subscribed to that room.
- Heartbeat is sent so proxies do not close idle streams.

## 3. Security

- User text is rendered as text, never as HTML; no `dangerouslySetInnerHTML`.
- Every API input is validated with Zod at the route boundary (types, ranges, lengths).
- All SQL is parameterized; no string-built queries.
- Rate limiting exists on POST routes and cannot be bypassed trivially (for example by a spoofed forwarded header).
- No secrets in the repo or git history; `.env.example` contains placeholders only.
- Error responses do not leak stack traces or SQL.
- `npm audit` shows no high or critical issues in production dependencies.

## 4. Architecture and maintainability

- The DB client is imported only inside `src/server/repositories/`; UI and route handlers use `ChatRepository`.
- Server state is in TanStack Query; the selected room is in the URL; no stray global state.
- Components are small and single-purpose; no copy-pasted helpers.
- No dead code, unused exports, unused dependencies, or leftover debug logging.
- Types are strict: no `any`, no unchecked casts that hide errors.
- Dependencies were not added without need.

## 5. AI-specific failure modes

- Imported packages and APIs actually exist and are used the way the installed version expects (check against `package.json` and docs, not memory).
- Over-engineering: abstractions, config, or generality nobody asked for.
- Logic that looks right but ignores an edge case (null, empty, timezone, off-by-one, concurrency).
- Errors swallowed by empty `catch` blocks or `console.log` only.
- Tests that assert nothing meaningful, mock away the thing under test, or only cover the happy path.
- Comments or docs that describe what the code should do rather than what it does.

## 6. Tests

- Every functional requirement has at least one test.
- Repository tests run against a real Postgres, including clustering and antimeridian cases.
- API tests cover success, 400, 404, and 429.
- E2E covers: create pin and post, reload persistence, two-browser live message, cluster expansion, bottom-sheet layout at 375 px.
- Tests are deterministic (no sleeps that cause flakiness) and pass from a clean clone.

## 7. Performance

- Queries used by the map and message list hit the indexes (check with `EXPLAIN` on a seeded table).
- No N+1 queries; no unbounded result sets.
- Map requests are debounced and cached; panning does not trigger request storms.

## 8. Usability and accessibility

- Form fields have labels; Submit is keyboard-reachable; focus is sensible after posting.
- The message list auto-scrolls to new messages without fighting the user when they have scrolled up.
- Loading, empty, and error states exist for rooms and messages.
- The layout works at 375 px wide (bottom sheet) and on desktop (right column); the map resizes correctly when the sheet opens or closes; dragging the map on touch never creates a room.
- Color contrast and touch targets (at least 44 px) are reasonable on a small screen.

## 9. Docs and operations

- README steps work from a clean clone: install, `docker compose up -d db`, migrate, run.
- PRD, DESIGN, and TASKS match what was built (API paths, schema, scope).
- `/health` endpoint works; logs go to stdout; config comes only from environment variables.
- Dockerfile builds and the container starts.
