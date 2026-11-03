# Wolfchatter v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Wolfchatter onto Supabase (data, live messages, Google sign-in), Vercel and Mapbox, on a separate `v2` branch, with the v1 experience otherwise unchanged.

**Architecture:** Next.js route handlers and Zod stay. A per-request `SupabaseChatRepository` acts as the caller, so row-level security applies. The browser talks to Supabase directly only for auth and live messages. Mapbox replaces Leaflet last, on an integration branch, so production stays working.

**Tech Stack:** Next.js 16, TypeScript, Supabase (`@supabase/supabase-js`, `@supabase/ssr`, Supabase CLI via the `supabase` npm package), `react-map-gl` with `mapbox-gl`, Vercel, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-wolfchatter-v2-design.md`

## Global Constraints

- All work stays on `v2` and is never merged to `main`. One branch and PR per task, targeting `v2` (Tasks 8 and 9 target `feat/v2-mapbox`). The owner merges and runs force-pushes.
- Pushing `v2` to origin for the first time needs the owner's OK. `v2` has no upstream yet, so use `git push -u origin v2`.
- Every shell starts with `nvm use`. Docker needs `export PATH=/Users/andreicimpan/.docker/bin:$PATH`.
- A task is done when `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e` pass, CI is green, and docs touched by the change are updated in the same commit. One exception: Tasks 4, 5 and 6 are stacked and merge together, so the full suite only passes at the end of Task 6.
- Conventional Commits. Comments explain why, not what. No `any`. Render user text as plain text.
- Application code imports Supabase only in `src/server/repositories/` and `src/lib/supabase/`. Data reads and writes always go through `ChatRepository`.
- Author format: "Ana P.", or "Ana" with no last name, or "Anonymous" with nothing usable. At most 32 characters.
- The name's source is `auth.identities.identity_data`, never `raw_user_meta_data`.
- UI copy, exactly: "Sign in with Google to post", "New chatroom", "Sign in to create a chatroom here. Your pin stays where you dropped it.", "Sign in with Google", "Discard", "Posting as {name}", "Sign out".
- Public env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_MAPBOX_STYLE` (default `mapbox://styles/mapbox/streets-v12`). Server or test only: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. Only `.env.example` is committed.
- Free plans only. If something appears to need a paid plan, stop and ask.
- Tests share the one local Supabase stack, and they empty it. Do not run test suites from two worktrees at once.
- If `auth.identities.identity_data` turns out to be user-editable, stop and raise it with the owner.

## Review Focus

- A crafted `next` on `/auth/callback` (`//evil.com`, `https://evil.com`, `/\evil.com`): must redirect inside the site. Pinned in Task 5.
- Cancelling at Google's screen, or returning with a bad or missing code: back to the same room or pin, signed out, with no 500. Pinned in Task 5.
- A session that ends while someone is typing: their text stays visible and the card explains why the post failed. Pinned in Task 6.
- A message posted immediately after a channel reports ready: arrives exactly once, including for a signed-out reader. Pinned in Task 3.
- A test run with `.env` pointing at the hosted project: must refuse to empty it. Pinned in Task 1.

---

### Task 1: Local Supabase and the v1 schema

Creates the local stack, the migrations and the database functions, with posting still open as in v1. There is no user data until the first deploy, so later migrations may delete rows.

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`), `supabase/migrations/20261103000001_init.sql`, `src/server/repositories/test/local-database.ts`, `src/server/repositories/test/local-database.test.ts`, `src/server/repositories/database-functions.test.ts`
- Modify: `package.json`, `.env.example`, `vitest.config.ts`, `src/server/repositories/test/global-setup.ts`, `src/server/repositories/test/test-db.ts`, `next.config.ts`, `.github/workflows/ci.yml`, `e2e/global-setup.ts`, `playwright.config.ts`, `CLAUDE.md` (Commands)
- Delete: `db/migrations/0001_init.sql`, `scripts/migrate.mts`, `scripts/migrate.test.mts`, `src/server/repositories/test/scratch-database.ts` and its test, `src/server/repositories/test/global-setup.test.ts` if it only covers the scratch setup, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/check-docker-shutdown.sh`, the `DOCKER_BUILD` handling in `next.config.ts`

**Interfaces:**
- Produces: `assertLocalDatabase(url: string): void` and SQL functions `list_messages(p_room_id uuid, p_before uuid, p_after uuid, p_limit int)`, `list_rooms_in_view(p_south, p_north, p_from1, p_to1, p_from2, p_to2 double precision, p_limit int)`, `list_room_cells(p_south, p_north, p_from1, p_to1, p_from2, p_to2, p_cell, p_center_lat, p_center_lng double precision, p_limit int)`, `create_room_with_message(p_lat, p_lng double precision, p_author text, p_body text) returns json` (`{ room, message }`).

- [ ] **Step 1: Create the branch, add the CLI, start the stack**

Run `git switch v2`, then `git switch -c feat/v2-supabase-schema`. Run `npm install -D supabase`, adding `"supabase": true` under `allowScripts` in `package.json` so its binary installs. Run `npx supabase init`, then `npx supabase start`.
Expected: `npx supabase status -o env` prints the API URL, anon key, service role key and DB URL.

- [ ] **Step 2: Write the failing guard test** (`local-database.test.ts`)

```ts
expect(() => assertLocalDatabase("postgresql://postgres:postgres@db.abc.supabase.co:5432/postgres")).toThrow();
expect(() => assertLocalDatabase("")).toThrow();
expect(() => assertLocalDatabase("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).not.toThrow();
expect(() => assertLocalDatabase("postgresql://postgres:postgres@localhost:54322/postgres")).not.toThrow();
```

- [ ] **Step 3: Run it and confirm it fails.** Run `npx vitest run local-database`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement the guard and the harness**

`assertLocalDatabase` parses the URL and allows only hosts `127.0.0.1` and `localhost`. `global-setup.ts` and `test-db.ts` call it on `SUPABASE_DB_URL` before any truncate, and connect with `pg`. `setupTestDatabase` keeps its truncate and its `room_number_seq` restart. `vitest.config.ts` drops `TEST_DATABASE_URL` and `APP_DATABASE_URL`, and sets `DATABASE_URL` to `SUPABASE_DB_URL`, so the Postgres repository and its tests keep running against the local stack until Task 2. `.env.example` and `package.json` swap to local Supabase values, with scripts `db:start` (`supabase start`) and `db:migrate` (`supabase migration up`).

- [ ] **Step 5: Write the failing function tests** (`database-functions.test.ts`, through `pg` as a superuser, porting v1's expectations)

- `list_messages` orders by `(created_at, id)`, and `before`, `after` and an unknown cursor behave as in `postgres-chat-repository.test.ts`.
- `list_room_cells` returns one row per cell, busiest first, then nearest the centre, with `(array_agg(...))[1]` for single-room cells.
- `create_room_with_message` with a body over 1000 characters leaves no room behind.
- Inserting a message increments `rooms.message_count`.
- Row-level security is on for both tables, and `messages` is in the `supabase_realtime` publication.

- [ ] **Step 6: Write the migration**

Port `db/migrations/0001_init.sql`, keeping `pg_notify` for now, because the SSE stream still depends on it until Task 3. Add the functions above, moving the SQL from `postgres-chat-repository.ts` unchanged. Enable row-level security with temporary policies: `select` for everyone, `insert` for `anon` and `authenticated`. `on_message_insert` is `security definer` with `set search_path = ''`. Add `messages` to `supabase_realtime`.

- [ ] **Step 7: Run the tests.** Run `npx supabase db reset`, then `npx vitest run local-database database-functions`. Expected: PASS.

- [ ] **Step 8: Update CI and e2e.** Remove the `docker` job. In `checks` and `e2e`, replace the Postgres service with `npx supabase start`, and write its values to `$GITHUB_ENV` from `npx supabase status -o env`. `e2e/global-setup.ts` calls `assertLocalDatabase` and truncates. `playwright.config.ts` passes `DATABASE_URL` from `SUPABASE_DB_URL` and drops `E2E_DATABASE_URL`, keeping the rate-limit overrides for now.

- [ ] **Step 9: Verify.** Run lint, typecheck, `npm test`, `npm run build`, `npm run e2e`. Expected: all pass, with the app still on its Postgres repository, now pointed at the local Supabase database.

- [ ] **Step 10: Commit.** `feat: add local Supabase with the v1 schema`

---

### Task 2: SupabaseChatRepository

**Files:**
- Create: `src/lib/supabase/config.ts` and test, `src/lib/message-row.ts` and test, `src/server/repositories/supabase-chat-repository.ts`, `src/server/repositories/supabase-chat-repository.test.ts` (port of the Postgres test)
- Modify: `src/server/repositories/index.ts`, `src/app/health/route.ts`, `src/app/api/rooms/route.ts`, `src/app/api/rooms/[id]/route.ts`, `src/app/api/rooms/[id]/messages/route.ts`, route tests, `next.config.ts`, `docs/DESIGN.md`, `docs/PRD.md`, `docs/TASKS.md`, `CLAUDE.md`, `README.md`
- Delete: `postgres-chat-repository.ts` and test, `db.ts` and `db.test.ts`, `schema.test.ts` if covered by Task 1

The SSE stream keeps running on Postgres `NOTIFY` until Task 3: `createMessageSource` connects `PostgresMessageSource` to `SUPABASE_DB_URL`, and `pg` stays a dependency.

**Interfaces:**
- Consumes: Task 1's SQL functions.
- Produces: `messageFromRow(row: MessageRow): Message`, `MessageRow = { id: string; room_id: string; author: string; body: string; created_at: string }` in `src/lib/message-row.ts` (shared with Task 3); `supabaseConfigFromEnv(): { url: string; anonKey: string }`; `class SupabaseChatRepository implements ChatRepository { constructor(client: SupabaseClient) }`; `getChatRepository(request: Request): ChatRepository` (sync, built from the request's cookies, every route passes its `Request`).

- [ ] **Step 1: Branch.** `git switch v2`, then `git switch -c feat/v2-supabase-repository`.

- [ ] **Step 2: Add dependencies.** `npm install @supabase/supabase-js @supabase/ssr`. Expected: `package.json` lists both.

- [ ] **Step 3: Write the failing tests**

`message-row.test.ts`:

```ts
expect(messageFromRow({ ...row, created_at: "2026-11-03T10:00:00.123456+00:00" }).createdAt).toBe("2026-11-03T10:00:00.123Z");
expect(messageFromRow({ ...row, created_at: "2026-11-03 10:00:00.123456+00" }).createdAt).toBe("2026-11-03T10:00:00.123Z");
```

`config.test.ts`: a missing URL or key throws, naming the variable.

`supabase-chat-repository.test.ts`: port every case from `postgres-chat-repository.test.ts` with the same expectations, using a client built with the anon key. Keep the cases for a malformed id, bounds across the antimeridian, the 500-item cap and zoom at `CLUSTER_MAX_ZOOM`.

- [ ] **Step 4: Run them and confirm they fail.** Run `npx vitest run message-row config supabase-chat-repository`. Expected: FAIL, modules not found.

- [ ] **Step 5: Implement**

The repository keeps `isUuid`, `clampLimit`, `viewportParams` and `toRoomItem`, and calls the SQL functions with `.rpc`. A foreign-key failure on `postMessage` (code `23503`) throws `RoomNotFoundError`. `ping()` runs a head-only select on `rooms` and throws on error. `getChatRepository(request)` uses `createServerClient` with `parseCookieHeader` for `getAll`, a no-op `setAll` and `autoRefreshToken: false`, because Task 5's proxy owns refreshes and a refresh here would rotate the token without saving it. `next.config.ts` calls `supabaseConfigFromEnv()` at startup, as it does for tiles. `getChatRepository` does not read `next/headers`, so route tests need no mocks and the prerendered page is unaffected.

- [ ] **Step 6: Update the routes and tests.** Each handler passes `request`. Health becomes `GET(request)`. Route tests keep their expectations.

- [ ] **Step 7: Verify.** Run lint, typecheck, `npm test`, `npm run build` and `npm run e2e`. Expected: all pass, and rooms and messages work through the app as in v1.

- [ ] **Step 8: Commit.** `feat: move the data layer to Supabase`

---

### Task 3: Live messages with Supabase Realtime

**Files:**
- Create: `src/lib/supabase/browser-client.ts`, `src/lib/supabase/room-channel.ts`, `src/lib/supabase/room-channel.test.ts` (against the local stack)
- Modify: `src/lib/room-stream.ts`, `src/lib/room-stream.test.ts`, `src/instrumentation.ts`, `e2e/messages.spec.ts`, `e2e/support.ts`, `supabase/migrations/20261103000001_init.sql` (nothing is deployed yet, so edit it in place to drop `pg_notify`), `package.json` (`pg` moves to `devDependencies`), `CLAUDE.md`, `docs/DESIGN.md`
- Delete: `src/server/realtime/`, `src/server/repositories/postgres-message-source.ts` and test, `src/server/repositories/test/tcp-proxy.ts`, `src/server/http/sse.ts`, `src/server/http/room-event-stream.ts` and tests, `src/app/api/rooms/[id]/stream/`, `createMessageSource` in `src/server/repositories/index.ts`

**Interfaces:**
- Consumes: `messageFromRow`, `supabaseConfigFromEnv`.
- Produces: `getBrowserSupabase(): SupabaseClient` (singleton `createBrowserClient`); `subscribeToRoomMessages(client: SupabaseClient, roomId: string, handlers: { onInsert(row: MessageRow): void; onStatus(status: "ready" | "failed"): void }): () => void`. `connectRoomStream(roomId, handlers, options)` keeps its name, its `RoomStreamHandlers` and `page`/`random` options, and replaces `createEventSource` with `subscribe?: (roomId, channelHandlers) => () => void`.

- [ ] **Step 1: Branch.** `git switch v2`, then `git switch -c feat/v2-realtime`.

- [ ] **Step 2: Write the failing integration test** (`room-channel.test.ts`, anon client, Node's global `WebSocket`)

- `delivers an insert to an anonymous subscriber`: after `ready`, insert a message, and `onInsert` receives a row whose `messageFromRow` equals what the repository returns for that message.
- `does not miss a message posted right after ready`: in a loop of 10 fresh rooms, subscribe, post inside the `ready` callback, and expect delivery.
- `only delivers the subscribed room`: an insert to another room is not delivered.

- [ ] **Step 3: Confirm it fails.** Run `npx vitest run room-channel`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `subscribeToRoomMessages`**

`postgres_changes`, `INSERT`, on `messages`, filter `room_id=eq.<id>`. `SUBSCRIBED` maps to `ready`; `CHANNEL_ERROR` and `TIMED_OUT` map to `failed`, and so does `CLOSED` unless the caller unsubscribed. Unsubscribe with `client.removeChannel`. If "right after ready" fails, also wait for the channel's `system` event reporting `postgres_changes` as ok before reporting `ready`, because `SUBSCRIBED` can come first.

- [ ] **Step 5: Rewrite `room-stream.test.ts` and `connectRoomStream`**

Keep every behaviour test against a fake `subscribe`: `ready` runs `onReady` and resets the backoff; `failed` unsubscribes and resubscribes after 1 s doubling to 30 s in the upper half of the wait; a hidden page holds no channel and resubscribes when shown; rows that fail `messageSchema` after `messageFromRow`, or belong to another room, are ignored. Remove the `EventSource` reconnect-count logic.

- [ ] **Step 6: Remove the server streaming code.** Delete the listed files and the `pg_notify` call. `instrumentation.ts` keeps only the rate-limit check, until Task 5.

- [ ] **Step 7: Update e2e**

Replace `dropRealtimeListener` with `dropLiveConnection(page)`, which uses `page.routeWebSocket(/\/realtime\/v1\/websocket/, ...)`, proxies with `connectToServer()`, and closes the socket on demand. Rewrite the three tests at `e2e/messages.spec.ts:273`, `:297` and `:491` on it, with the same expectations: messages sent meanwhile appear once and in order. Add `a signed-out reader sees a message live` (it becomes meaningful in Task 6, and passes trivially now).

- [ ] **Step 8: Verify.** Run lint, typecheck, `npm test`, `npm run build`, `npm run e2e`. Expected: all pass.

- [ ] **Step 9: Commit.** `feat: deliver live messages with Supabase Realtime`

---

### Task 4: Author names and row-level security

**Owner action at the start:** create the Google OAuth client (consent screen "In production", scopes `openid`, `email`, `profile`; redirect URI `http://127.0.0.1:54321/auth/v1/callback`) and put its ID and secret in `.env`. There is no sign-in button yet, so open `http://127.0.0.1:54321/auth/v1/authorize?provider=google` in a browser, finish the sign-in, and inspect the new row in `auth.identities`, to see whether `identity_data` holds `given_name` and `family_name`.

**Files:**
- Create: `supabase/migrations/20261103000002_auth.sql`, `src/server/repositories/author-name.test.ts`, `src/server/repositories/row-level-security.test.ts`, `src/server/repositories/test/test-users.ts`
- Modify: `supabase/config.toml` (`[auth.external.google]` with `env(...)` secrets, `additional_redirect_urls` for `http://localhost:3000/**` and `:3100`), `.env.example`

**Interfaces:**
- Produces: SQL `format_author(identity jsonb) returns text`, `current_author_name() returns text` (null when signed out), a `before insert` trigger on `messages`. `create_room_with_message(p_lat, p_lng, p_body)`, which drops `p_author`. Test helpers `createTestUser(name: { full_name?: string; given_name?: string; family_name?: string }): Promise<{ userId: string; client: SupabaseClient; session: Session }>`, which creates a user through the admin API and writes `identity_data` with `pg`.

- [ ] **Step 1: Branch.** `git switch v2`, then `git switch -c feat/v2-auth-schema`.

- [ ] **Step 2: Write the failing name tests** (`author-name.test.ts`)

| `identity_data` | `format_author` result |
|---|---|
| `{given_name:"Ana", family_name:"Popescu"}` | `Ana P.` |
| `{given_name:"Ana Maria", family_name:"Popescu"}` | `Ana Maria P.` |
| `{full_name:"Ana Maria Popescu"}` | `Ana P.` |
| `{full_name:"Ana"}` | `Ana` |
| `{name:"  Ana   Popescu "}` | `Ana P.` |
| `{full_name:"Ana Élan"}` | `Ana É.` |
| `{given_name:"😀", family_name:"Popescu"}` | `😀 P.` |
| `{full_name:"   "}` | `Anonymous` |
| `{}` | `Anonymous` |
| `{given_name:<40 x "a">, family_name:"Popescu"}` | 29 x `a` + ` P.` (32 characters) |

- [ ] **Step 3: Write the failing security tests** (`row-level-security.test.ts`)

- A signed-out insert into `rooms` and `messages`, and an anon call to `create_room_with_message`, fail with `42501`.
- A signed-in insert with another user's `user_id` fails.
- A signed-in insert that sends `author: "Someone Else"` stores no such name, whether it is refused or overwritten.
- `updateUser({ data: { full_name: "Someone Else", given_name: "Someone" } })`, followed by a post, still stores the original name. **If this fails, stop and raise it.**
- Direct inserts cannot set `created_at` or `message_count` or `title`.
- Update and delete on both tables affect no rows for a signed-in user.
- Anon `select` works on both tables, and anon still receives Realtime inserts.

- [ ] **Step 4: Confirm they fail.** Run `npx vitest run author-name row-level-security`. Expected: FAIL.

- [ ] **Step 5: Write the migration**

Delete all rows first, since nothing is deployed. Add `rooms.created_by` and `messages.user_id`, both `not null references auth.users default auth.uid()`. Replace the temporary policies with those in the spec's table. Revoke table insert from `anon`. Grant `authenticated` only `insert (lat, lng)` on `rooms` and `insert (room_id, body)` on `messages`, so a direct call cannot set anything else. The trigger is `security definer` with `set search_path = ''`, reads the newest `auth.identities` row for `auth.uid()`, preferring `provider = 'google'`, and sets `new.author`. `current_author_name()` uses the same lookup. Grant `create_room_with_message` to `authenticated` only.

- [ ] **Step 6: Run the tests.** Run `npx supabase db reset`, then `npx vitest run author-name row-level-security`. Expected: PASS.

- [ ] **Step 7: Land with Task 5.** This migration removes the API's `p_author` and open posting, so the repository's tests fail until Task 5. Base Task 5 on this branch, and merge Tasks 4 to 6 together.

- [ ] **Step 8: Commit.** `feat: set author names in the database and restrict writes`

---

### Task 5: Sessions and the signed-in API

**Files:**
- Create: `src/server/repositories/supabase-session.ts`, `src/proxy.ts`, `src/app/auth/callback/route.ts` and test, `src/lib/safe-next-path.ts` and test, `src/app/api/me/route.ts` and test, `src/server/repositories/test/session-cookies.ts`
- Modify: `chat-repository.ts`, `supabase-chat-repository.ts` and test, `src/lib/schemas.ts` and test, `src/server/http/api-errors.ts` and test, route handlers and tests, `src/lib/types.ts`, `src/instrumentation.ts`, `.env.example`, `docs/DESIGN.md`
- Delete: `src/server/http/rate-limit.ts`, `client-ip.ts` and tests, `RATE_LIMIT_*` in `playwright.config.ts`, `src/instrumentation.ts` if now empty

**Interfaces:**
- Consumes: Task 4's SQL, `createTestUser`.
- Produces: `postMessage(roomId, { body })`; `createRoomWithMessage(room, { body })`; `currentAuthorName(): Promise<string | null>` on `ChatRepository`; `class NotSignedInError extends Error`; `postMessageSchema = { body }`; `GET /api/me` answering `{ name: string | null }` with `Cache-Control: no-store`; `safeNextPath(raw: string | null): string`; `refreshSession(request: NextRequest): Promise<NextResponse>`; `exchangeCodeForSession(request: Request, code: string, response: Response): Promise<boolean>`; `sessionCookieHeader(session: Session): Promise<string>` for tests.

- [ ] **Step 1: Branch from Task 4.** `git switch feat/v2-auth-schema`, then `git switch -c feat/v2-auth-api`.

- [ ] **Step 2: Write the failing tests**

`safe-next-path.test.ts`:

```ts
expect(safeNextPath("/?room=abc")).toBe("/?room=abc");
for (const bad of [null, "", "//evil.com", "https://evil.com", "/\\evil.com", "\\evil.com", "/%5Cevil.com"]) {
  expect(safeNextPath(bad)).toBe("/");
}
```

`auth/callback/route.test.ts`:
- `?error=access_denied&next=/?room=x` redirects to `/?room=x` with no session cookie.
- A missing or invalid `code` redirects to `next` signed out, never a 500.
- `?code=x&next=//evil.com` redirects to the app's own origin.

Route tests:
- POST to both routes without a session cookie gives 401 with `error.code === "unauthenticated"`.
- With `sessionCookieHeader`, POST gives 201, and `author` equals the test user's formatted name even when the body sends `author: "X"`.
- A body that sends only `author` gives 400.
- GET `/api/me` gives `{ name: null }` signed out and `{ name: "Ana P." }` signed in.
- GET routes work without a cookie.

- [ ] **Step 3: Confirm they fail.** Run `npx vitest run safe-next-path callback me rooms`. Expected: FAIL.

- [ ] **Step 4: Implement**

- The repository maps Postgres `42501` and PostgREST's expired-token errors to `NotSignedInError`. `withErrorHandling` answers 401 `unauthenticated`, so validation still runs first and an invalid signed-out post gets a 400.
- `refreshSession` follows `@supabase/ssr`'s documented Next pattern, and returns `NextResponse.next()` with no Supabase call when there is no `sb-` cookie, so anonymous readers cost no auth requests.
- `src/proxy.ts` matches pages and `/api/*`, excluding `_next` and images. Check `npm run build` still prerenders under `cacheComponents`.
- The callback uses `new URL(request.url).origin` plus `safeNextPath`.
- Remove `enforceRateLimit` calls and the listed files. Keep the JSON and `Content-Type` checks.

- [ ] **Step 5: Run the tests.** Run `npm test`. Expected: PASS.

- [ ] **Step 6: Commit.** `feat: require a session to post and add Google sign-in routes`

The UI still sends `author` and has no sign-in, so `npm run e2e` is expected to fail until Task 6. Merge Tasks 4, 5 and 6 into `v2` together.

---

### Task 6: Sign-in in the chat card

**Files:**
- Create: `src/hooks/useCurrentUser.ts` and test, `src/lib/pending-draft.ts` and test, `src/components/SignInPrompt.tsx`, `src/components/PostingAs.tsx`, `e2e/auth.spec.ts`
- Modify: `src/lib/api-client.ts` and test, `src/hooks/useMessages.ts` and test, `src/hooks/useCreateRoom.ts` and test, `src/components/MessageForm.tsx`, `src/components/RoomPanel.tsx` and test, `src/components/ChatShell.tsx`, `src/lib/limits.ts`, `e2e/support.ts`, `e2e/*.spec.ts`, `playwright.config.ts`, `docs/PRD.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `README.md`
- Delete: `src/lib/saved-username.ts` and test

**Interfaces:**
- Consumes: `getBrowserSupabase`, `GET /api/me`, `createTestUser`, `sessionCookieHeader`.
- Produces: `useCurrentUser(): { status: "loading" | "signedOut" | "signedIn"; name: string | null }` (TanStack Query key `["me"]`, invalidated on `onAuthStateChange`); `signInWithGoogle(options?: { draft?: { lat: number; lng: number } }): Promise<void>`; `signOut(): Promise<void>`; `getMe(): Promise<{ name: string | null }>`; `savePendingDraft(storage: Storage, position): void`; `takePendingDraft(storage: Storage): { lat: number; lng: number } | null`; `send(body, onSent)` everywhere `send(author, body, onSent)` was; `messageInputError(body: string): string | null`; `isSignedOutError(error: Error): boolean`.

- [ ] **Step 1: Branch from Task 5.** `git switch feat/v2-auth-api`, then `git switch -c feat/v2-sign-in-ui`.

- [ ] **Step 2: Write the failing unit tests**

- `pending-draft.test.ts`: a save and a take return the position; a second take returns `null`; malformed JSON, `lat: 91` and missing keys return `null` and clear the entry.
- `useMessages.test.ts`: `messageInputError("")` is `"Enter a message."`. `postMessageErrorMessage(new ApiError(401, "unauthenticated", ""))` is `"You've been signed out. Signing in again clears this message, so copy it first."`
- `useCreateRoom.test.ts`: `createRoomErrorMessage` on a 401 gives the same text, and `createRoom` sends `{ lat, lng, firstMessage: { body } }`.
- `api-client.test.ts`: `postMessage(id, { body })` sends only `body`; `getMe()` returns `{ name }`.

- [ ] **Step 3: Confirm they fail.** Run `npx vitest run pending-draft useMessages useCreateRoom api-client`. Expected: FAIL.

- [ ] **Step 4: Implement the hooks and API client**

`signInWithGoogle` saves any draft, then calls `signInWithOAuth` with `redirectTo: origin + "/auth/callback?next=" + encodeURIComponent(pathname + search)`. Remove the 429 branches and `retryAfterPhrase`, since nothing sends 429 now. Keep `AUTHOR_MAX` only if a test needs it; the database owns the limit.

- [ ] **Step 5: Write the failing e2e tests** (`e2e/auth.spec.ts`)

Add `signInAs(context, name = "Ana Popescu")` to `support.ts`. It calls `createTestUser`, then `context.addCookies` with the session cookies, so the app contains no test login. A new auto fixture `signedIn` (option, default `true`) applies it. Add 401 to `EXPECTED_CONSOLE_ERRORS`.

- Signed out with a room open: messages are visible, `Sign in with Google to post` shows, and there is no message field.
- Signed out, clicking the map: the card shows `New chatroom`, the exact note, `Sign in with Google` and `Discard`, and the grey pin is on the map.
- Signed in: `Posting as Ana P.` and `Sign out` show, and there is no username field.
- A post shows `Ana P.` as its author.
- `Sign out` brings back the signed-out prompt without a reload.
- Reloading while signed in keeps the session.
- Returning to a pin: with `sessionStorage` seeded the way `signInWithGoogle` seeds it, loading the page restores the draft at those coordinates, and it survives no second reload.
- Clicking `Sign in with Google` navigates to a URL containing `/auth/v1/authorize?provider=google` with `redirect_to` carrying `next`; intercept it and do not follow.
- A session ending mid-use: revoke the cookies with typed text in the field, and on Submit the text is still there and the signed-out message shows.
- A signed-out reader in a second context sees a message posted by a signed-in one live.

- [ ] **Step 6: Implement the components**

`SignInPrompt` takes `label` and optional `draft`. `RoomContent` shows the form when `signedIn`, the prompt when `signedOut`, and neither while `loading`, so nothing flashes. `DraftContent` swaps `DRAFT_NOTE` and the form for the signed-out note and prompt. `PostingAs` sits directly above the form fields, with the sign-out link. A 401 shows the error plus a `SignInPrompt`, with the form still on screen. `ChatShell` restores a pending draft in a mount effect through `startDraft`. Remove all `author` props and the username input.

- [ ] **Step 7: Update the existing e2e specs.** Remove the username steps (`usernameField` and the 47 matching lines), and expect the test user's name wherever a test asserted its typed username. Tests of username persistence are deleted. Tests of 429 messages are deleted.

- [ ] **Step 8: Verify, and try it for real**

Run lint, typecheck, `npm test`, `npm run build`, `npm run e2e`. Expected: all pass. Then the **owner** runs `npm run dev` and signs in with real Google, from a room and from a pin. Expected: they return to the same room or pin, and their name appears as "First L."

- [ ] **Step 9: Commit.** `feat: sign in with Google from the chat card`

Merge Tasks 4, 5 and 6 into `v2`.

---

### Task 7: Deploy to Vercel (owner-led)

There is no new code unless deployment finds a bug. The agent prepares the checklist in the README and verifies the result. The owner does the steps needing dashboards or secrets.

**Files:**
- Modify: `README.md` (Deploy and Shut down sections), `docs/PRD.md`, `docs/TASKS.md`

- [ ] **Step 1: Hosted Supabase (owner).** Create a project. Run `npx supabase link`, then `npx supabase db push`. Enable Google under Auth with the client from Task 4. Add `https://<project>.supabase.co/auth/v1/callback` to the Google client's redirect URIs. Keep password sign-in off. Confirm Realtime is enabled for `messages`: the migration's publication should cover it.

- [ ] **Step 2: Vercel (owner).** Import the repo, set the production branch to `v2`, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and deploy. Never set the service role key here. Add `https://<app>.vercel.app/**` to Supabase's redirect URLs, and set the site URL.

- [ ] **Step 3: Confirm Google needs no verification (owner).** A Google account not listed as a tester can sign in with basic scopes. If not, stop and report.

- [ ] **Step 4: Check it by hand (owner and agent).** On a desktop and a phone, check real sign-in, returning to a room and to a pin, two browsers seeing a message live, a signed-out reader seeing it live, and `/health` answering 200.
Expected: all work. Leaflet with OpenStreetMap's tiles is still the map.

- [ ] **Step 5: Commit the docs.** `docs: add v2 deployment and shutdown steps`

---

### Task 8: Mapbox map and pins

**All of Tasks 8 and 9 go on `feat/v2-mapbox`, created from `v2`, and merge into `v2` only when both pass.** Vercel deploys `v2`, and the map is incomplete in between. Cluster and zoom constants change here, which is why they cannot land separately from the map.

**Owner action:** create the two Mapbox tokens: one limited to the Vercel URL, set in Vercel, and one for local use in `.env`. Set a usage notification in the Mapbox console.

**Files:**
- Create: `src/components/MapboxMap.tsx`, `src/lib/map-config.ts` (rewritten)
- Modify: `src/components/MapMarkers.tsx`, `src/hooks/useFlyToRoom.ts`, `src/components/MapView.tsx`, `src/components/ChatShell.tsx` (focus target and `isolate` comment), `src/lib/map-grid.ts` and test, `src/lib/viewport.ts` and test, `src/lib/map-focus.ts` and test, `src/lib/map-config.test.ts`, `next.config.ts`, `src/app/globals.css`, `src/lib/limits.ts`, `e2e/support.ts`, `package.json`, `.env.example`
- Delete: `src/components/LeafletMap.tsx`, `leaflet`, `react-leaflet`, `@types/leaflet`

**Interfaces:**
- Consumes: the props of `LeafletMapProps` (renamed `MapboxMapProps`, unchanged), `useMapItems`, `nearestWorldCopy`.
- Produces: `resolveMapboxConfig(env: { token?: string; style?: string }): { token: string; style: string }` and `mapboxConfigFromEnv()`; `INITIAL_VIEW = { longitude: 20, latitude: 48, zoom: 4 }`; `CLUSTER_MAX_ZOOM = 15`; `clusterCellSize(zoom) = (360 / 2 ** zoom) * 0.125`; `WORLD_PX = 512`; `stubMapbox(page)` in `e2e/support.ts`.

- [ ] **Step 1: Branch and install.** `git switch v2`, `git switch -c feat/v2-mapbox`, then `npm install react-map-gl mapbox-gl`. Remove Leaflet and its types only at the end of this task, once nothing imports them.

- [ ] **Step 2: Write the failing unit tests**

```ts
// map-grid.test.ts: the cell is still about 64 px, on Mapbox's 512 px world.
expect(clusterCellSize(4)).toBe(360 / 16 / 8);
expect(CLUSTER_MAX_ZOOM).toBe(15);
// viewport.test.ts: snapping stays at 256 px, so padding and the 500-cell cap behave as in v1.
// The step at z is 360 / 2 ** (z + 1), so here 22.5, where v1's step of 45 would give 0.
expect(viewportQuery({ west: 23, south: 1, east: 24, north: 2 }, 3).bbox.west).toBe(22.5);
// A fractional zoom rounds for the query.
expect(viewportQuery(bounds, 4.4).zoom).toBe(4);
// map-focus.test.ts: half of Mapbox's world at zoom 0, less the margin.
expect(focusShiftPx(0, true)).toBe(198);
expect(focusShiftPx(-1, true)).toBe(127);
// map-config.test.ts
expect(() => resolveMapboxConfig({ token: "" })).toThrow(/NEXT_PUBLIC_MAPBOX_TOKEN/);
expect(resolveMapboxConfig({ token: "pk.x" }).style).toBe("mapbox://styles/mapbox/streets-v12");
```

- [ ] **Step 3: Confirm they fail.** Run `npx vitest run map-grid viewport map-focus map-config`. Expected: FAIL.

- [ ] **Step 4: Update the constants and config.** Implement the values above. `next.config.ts` calls `mapboxConfigFromEnv()`.

- [ ] **Step 5: Add `stubMapbox(page)` and make it an auto fixture**

Run e2e with a fake `pk.e2e` token. Route `https://*.mapbox.com/**` and `https://api.mapbox.com/**`: styles answer `{ version: 8, sources: {}, layers: [] }`, everything else an empty success. Fail the test on any unstubbed Mapbox request, so tests can't spend map loads. Add `--enable-unsafe-swiftshader` to Chromium's args in `playwright.config.ts`, and confirm WebGL starts headless and in CI. If it can't, stop and raise it.

- [ ] **Step 6: Build `MapboxMap`**

From `react-map-gl/mapbox`. Set `projection="mercator"` and `renderWorldCopies`, because the grid and bounds logic assumes a flat, repeating world and Mapbox's newer styles default to a globe. Set `dragRotate={false}`, `touchPitch={false}`, `maxPitch={0}` and disable touch rotation, because the bbox assumes north-up. Add `NavigationControl` without a compass, top-left. Keep logo and attribution on. Port `TrackViewport`: report on load and on debounced `moveend`, through `viewportQuery`'s rounding, removing the whole-zoom skip, because Mapbox only fires `moveend` after a flight. Mapbox has no equivalent of `ResizeObserver` calling `invalidateSize`; keep the observer and call `map.resize()`, and confirm the resize's own `moveend` causes no extra request.

- [ ] **Step 7: Port pins, clusters and flying**

`MapMarkers` uses `Marker`, with the v1 pin images moved to `public/` so they keep their size and alt text, and `.draft-pin` applied. Marker clicks reach the map on Mapbox, so each marker handler must call `originalEvent.stopPropagation()`, or a pin click would also drop a draft. Mapbox wraps markers to the nearest copy by itself, so remove `nearestWorldCopy` and the pin anchor unless a test shows the pin hopping. `ClusterMarker` keeps a real `<button>` with `aria-label` from `clusterBubble`, and zooms with `Math.max(zoom + 1, cameraForBounds(cell).zoom)`, capped at `CLUSTER_MAX_ZOOM`. `useFlyToRoom` keeps its rules and uses `flyTo({ center, zoom, offset: [-shiftX, 0] })`, with `animate: false` for page opens and reduced motion. Remove the fractional-zoom correction on drag, since fractional zoom is now normal.

- [ ] **Step 8: Verify by hand locally.** With the local token, confirm the map loads at central Europe, pins and clusters appear, and clicking a pin flies to it with the panel beside it. Expected: as in v1. Clicks on the empty map are done in Task 9.

- [ ] **Step 9: Commit.** `feat: draw the map and pins with Mapbox`

---

### Task 9: Mapbox clicks, keyboard and the e2e port

**Files:**
- Create: `src/components/MapInteractions.tsx` if `MapboxMap.tsx` grows too large
- Modify: `src/components/MapboxMap.tsx`, `src/components/MapMarkers.tsx`, `src/components/ChatShell.tsx`, `e2e/rooms.spec.ts`, `e2e/layout.spec.ts`, `e2e/viewport.spec.ts`, `e2e/persistence.spec.ts`, `e2e/support.ts`, `docs/PRD.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: `MapboxMap`, `stubMapbox`.
- Produces: `.env.example` and docs describing the final stack.

- [ ] **Step 1: Port the e2e selectors first, and watch them fail**

Replace the 100 Leaflet references: `.leaflet-container` becomes `.mapboxgl-canvas-container`, the focus target `.mapboxgl-canvas`, `.leaflet-marker-icon` the pin's own element, and `.leaflet-control-zoom-in` `.mapboxgl-ctrl-zoom-in`. `tileZooms` and `makeTilesHitTestable` are replaced by `mapZoom(page)` reading a `data-zoom` attribute the map sets, since there are no tile images to inspect. Keep every behaviour test: only update zoom values to Mapbox's scale (5 becomes 4, 16 becomes 15).
Run: `npm run e2e`. Expected: click, double-click and keyboard tests FAIL. List them, and use them as the checklist below.

- [ ] **Step 2: Port `ClickToDraft`**

Keep the 500 and 250 ms waits and all cancel paths. Map `dragstart`, `zoomstart`, `click` and `dblclick` to Mapbox's events. Mapbox has no `preclick`, so use a `mousedown` listener on the canvas container, which also fires for presses on a marker, to run the `droppedBeforeThisClick` swap. Mapbox's own double-click zoom must still run, so don't disable it. Keep `isPastWorldEdge` and its 85.0511 limit: it costs nothing, and a pin past the edge could not be drawn.

- [ ] **Step 3: Port `EnterToDraft`**

Set `role` and `aria-label` on `map.getCanvas()`, which is Mapbox's focus target. Keep the pointer-focus tracking and modifier checks. Compute the point with `map.unproject([x / 2 - shiftX, y / 2])`. `discardFromPanel` in `ChatShell` focuses `.mapboxgl-canvas`. Move focus the same way after a keyboard cluster zoom.

- [ ] **Step 4: Run everything.** Run lint, typecheck, `npm test`, `npm run build`, `npm run e2e`. Expected: PASS. Where a v1 behaviour truly can't be matched, record it in `docs/DESIGN.md` under Known limitations and change that test to the new behaviour, and tell the owner.

- [ ] **Step 5: Check by hand.** On desktop and a phone: double-click zooms and leaves no pin, a single click drops one, dragging drops none, Enter on the focused map drops one, Mapbox's logo and attribution are visible on the mobile banner layout, and a phone on its side still works. Expected: all work.

- [ ] **Step 6: Finish the docs.** `docs/DESIGN.md`, `docs/PRD.md` and `CLAUDE.md` describe the v2 stack, and `docs/DESIGN.md` loses its SSE, rate-limiting and Docker sections. `docs/INFRA.md` gains one line saying it describes v1 on `main`. `README.md` covers setup from zero and shutdown. Replace `docs/TASKS.md` section 8 with these tasks, ticked.

- [ ] **Step 7: Commit, merge and deploy.** `feat: handle map clicks and keyboard on Mapbox`. Merge `feat/v2-mapbox` into `v2` (the owner merges). Then repeat Task 7's Step 4 on the public link, and confirm requests carry the URL-limited token.
