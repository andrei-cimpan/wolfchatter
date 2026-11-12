# Wolfchatter v2: Design

3 Nov 2026 · Status: implementation plan written (`docs/superpowers/plans/2026-11-03-wolfchatter-v2.md`)

Read with `docs/PRD.md` and `docs/DESIGN.md`, which describe v1. Everything not mentioned here behaves as v1 does.

## Intent

v2 is a personal experiment, separate from the brief v1 was built for. The owner wants hands-on experience of Supabase, Mapbox and Vercel by moving a real app onto them. It will run for a limited time, used by a handful of people the owner knows, and then be shut down.

The result is judged by whether the app works on that stack, not by whether people take to it.

## Goals

- The v1 experience (map, draft pins, rooms, live messages, responsive layout) works unchanged apart from sign-in.
- Data, live delivery and auth run on Supabase.
- Sign-up and sign-in use Google only. Anyone can read; posting needs an account.
- The map runs on Mapbox.
- The app is reachable at a public Vercel link.

## Non-goals

- Moderation, admin screens, account deletion, backups, room deletion.
- Scale work: the 50k-user assumptions, `docs/INFRA.md` and the AWS path do not apply.
- New chat features. Rooms created by others still appear only on a map refetch, as in v1.
- Moving v1's existing data. v2 starts empty.

## Anti-goals

- Changing `main`. v1 must stay submittable, so all v2 work stays on the `v2` branch and is never merged back.
- Any planned spending: free plans only. If something needs a paid plan, stop and ask. The one accepted exception is Mapbox's possible overage, under "Deployment".
- Real full names on public pages.

## Decisions the owner made

- **Sign-in:** Google only, through Supabase Auth. Any Google account is accepted, including Workspace accounts, not only @gmail.com.
- **Author name:** first name plus the first letter of the last name ("Ana P."), or just the first name when Google has no last name.
- **Sign-in placement (mockup A):** everything lives in the chat card, and nothing new goes on the map.
  - Signed out, in a room: messages are readable, and "Sign in with Google to post" replaces the form.
  - Signed out, after clicking the map: the draft pin drops, and the card reads "New chatroom", "Sign in to create a chatroom here. Your pin stays where you dropped it.", with a "Sign in with Google" button and "Discard".
  - Signed in: "Posting as Ana P." and a "Sign out" link above the message field and Submit. The username field is gone.
  - Sign-out is reachable only with a room or draft open. The owner accepted this.
- **Stack:** Supabase (Postgres, Realtime, Auth), Mapbox via react-map-gl, Vercel. The owner has accounts on all three and on Google Cloud.
- **Mapbox token:** limited to the Vercel URL, on the owner's existing account with a card.
- **Order of work:** the five steps under "Order of work" below, with Mapbox last.

## Calls the designer made

The owner saw these and raised no objection. They can still be changed.

- REST routes and Zod validation stay, so the UI changes little. The browser talks to Supabase directly only for auth and live messages.
- A message keeps the name it was posted under.
- Per-IP rate limits, the Dockerfile, Compose's app service, and the streaming server code are removed on this branch.
- `/health` stays, since it costs nothing to keep.
- Author names come from a source users cannot edit (see Database), after the design review found that account metadata can be changed by its owner.
- Local development signs in with real Google, so the Google OAuth client is created at step 3 (see Sign-in).

## Design

### Branch and docs

Create a long-lived `v2` branch from `main`. One branch and PR per task, targeting `v2`. On this branch, `CLAUDE.md`, `docs/PRD.md`, `docs/DESIGN.md`, `docs/TASKS.md` and the README are updated as each step lands, so they describe v2. `docs/TASKS.md` section 8 is replaced by the plan's tasks in its first task, and each task ticks its own line.

`CLAUDE.md` gets one changed architecture rule: application code may import the browser Supabase client from one small module, only for auth and for subscribing to live messages. All data reads and writes still go through `ChatRepository`.

### Database

SQL migrations move to `supabase/migrations/`, starting from v1's schema, and are applied with the Supabase CLI. `scripts/migrate.mts` goes away.

Changes from v1:

- `rooms` gains `created_by uuid not null references auth.users`.
- `messages` gains `user_id uuid not null references auth.users`.
- `messages.author` is filled in by a `before insert` trigger, overwriting anything sent. The Supabase anon key is public and the database API can be called directly, so the name must be set in the database, not in the route.
- **The name's source must be one the user cannot edit.** `auth.users.raw_user_meta_data` does not qualify, because a signed-in user can change it with `updateUser`. Read `auth.identities.identity_data` instead, and confirm during step 3 that users cannot edit it. If that turns out wrong, stop and raise it, since "nobody can post as someone else" is a promise of this design.
- The name is built by one tested SQL function. It uses separate first and last name fields when the source has them, otherwise it splits the full name: first word, plus the first letter of the last word when there is more than one. Names are cut to fit the 32-character limit. If nothing usable exists, the author is "Anonymous", so a post never fails over a missing name. Whether Supabase keeps Google's separate fields is unconfirmed: inspect a real sign-in at step 3 before relying on them.
- `on_message_insert` stops calling `pg_notify`, and keeps `message_count` up to date. Since posters cannot update `rooms`, it runs as `security definer`.
- `create_room_with_message` and the clustering query become Postgres functions called over RPC, because the Supabase client has no multi-statement transactions or grouped grid query. Clustering results must match v1's, reusing its grid rules.
- `messages` is added to the `supabase_realtime` publication.

**Row-level security**

| Table | Read | Insert | Update, delete |
|---|---|---|---|
| `rooms` | anyone | signed in, `created_by = auth.uid()` | nobody |
| `messages` | anyone | signed in, `user_id = auth.uid()` | nobody |

### Repository and routes

- `SupabaseChatRepository` implements `ChatRepository` and replaces `PostgresChatRepository`. It lives in `src/server/repositories/`.
- A repository acts as the caller, using a Supabase server client built from the request's cookies with `@supabase/ssr`, so row-level security applies. `getChatRepository()` therefore becomes per-request and likely async. Follow the Next 16 rules on `cookies()` so the prerendered page still builds under `cacheComponents`.
- `author` leaves the API: `postMessage` and `createRoomWithMessage` take only the body, and `postMessageSchema` drops the field. The `Message` type keeps `author`.
- POST routes with no valid session answer **401** with a new code, `unauthenticated`, using the existing error shape. GET routes stay public.
- `src/server/http/rate-limit.ts`, `client-ip.ts`, the `RATE_LIMIT_*` settings and their startup check go away. `Content-Type` and body size checks stay.

### Sign-in

- `signInWithOAuth` with Google, and an `/auth/callback` route that exchanges the code for a session cookie. Sessions are refreshed the way `@supabase/ssr` documents for Next.
- Requested data is limited to Google's basic profile and email.
- **Coming back:** the user returns to the same `?room=<id>`. A draft's coordinates are kept in `sessionStorage` before leaving for Google and restored on return. There is no typed text to lose, because the message field appears only when signed in.
- **Session ending mid-use:** a 401 shows the signed-out prompt in the card, keeps any typed text on screen until the redirect, and warns that signing in clears it.
- `src/lib/saved-username.ts` and the username state in `RoomPanel` go away.
- Redirect URLs allow localhost and the Vercel production URL. Preview deployments are not supported for sign-in.
- **Local development signs in with real Google.** The Google OAuth client is created at step 3, not step 4, and local Supabase is given its credentials through `supabase/config.toml` and a secret in `.env`. The hosted Supabase project is still not needed until step 4, which adds its callback URL to the same client.

### Live messages

- The browser subscribes to `postgres_changes` inserts on `messages`, filtered by `room_id`, with the anon key, so signed-out readers get live messages too. Supabase recommends Broadcast at larger scale, but Postgres Changes needs less setup and suits this group size. Confirm in the first step that an anonymous subscriber receives events under the policies above.
- `connectRoomStream` is rewritten on Supabase's client: Realtime's `system` message saying `postgres_changes` is running plays the role of v1's `ready` event (the channel's `SUBSCRIBED` came about 2 s earlier on a cold start, and a message posted in between was lost; Task 3), and channel errors feed the same backoff. Each payload is converted to the API's `Message` shape and checked with `messageSchema`.
- `useRoomStream`'s catch-up, de-duplication and hidden-tab behaviour stay. Each resubscribe still refetches with `after=`.
- Removed: `src/server/realtime/`, `postgres-message-source.ts`, `src/server/http/sse.ts`, `room-event-stream.ts`, `/api/rooms/:id/stream`, and the shutdown handling in `src/instrumentation.ts`.

### Mapbox

- react-map-gl replaces react-leaflet, and `LeafletMap.tsx`, `MapMarkers.tsx`, `useFlyToRoom.ts` and `map-config.ts` are rewritten. Leaflet is removed.
- Every behaviour in `docs/DESIGN.md` under "UI behavior" and "Responsive layout" stays unless it is impossible on Mapbox, in which case the doc records the difference: draft pins, click versus double-click timing, cluster bubbles and their accessible names, keyboard Enter, flying to a selected pin, and the world-copy handling.
- Clustering stays server-side. Mapbox's built-in clustering is not used, so the API and cluster bubbles are unchanged.
- **Zoom scale differs:** Mapbox zoom levels are one lower than Leaflet's for the same view, because its tiles are 512 px rather than 256 px. The 64 px grid in `src/lib/map-grid.ts`, the padding in `src/lib/viewport.ts`, the zoom 16 cutoff and the default view (Leaflet's zoom 5) must be recalculated, not carried over.
- **Fractional zoom is normal on Mapbox**, while the API takes whole zooms, so v1's "skip while the zoom is not whole" logic needs rethinking rather than porting.
- The token is a public Mapbox token in `NEXT_PUBLIC_MAPBOX_TOKEN`. The deployed site uses one restricted by URL to the Vercel production address, as the owner decided. Local development uses a separate token, because the deployed one will not work on localhost. The style is `NEXT_PUBLIC_MAPBOX_STYLE`, defaulting to Mapbox Streets.
- Mapbox's logo and attribution stay visible, including on the mobile banner layout.

### Deployment

Vercel's free Hobby plan, deploying the `v2` branch as production, with Supabase's free plan. Vercel settings hold the environment variables. Migrations are run by hand with the Supabase CLI before a deploy that needs them.

For Google sign-in to work without listing each user's email, the OAuth app is set to "In production" with basic scopes only. Confirm while setting up that Google requires no verification for those scopes. Google's consent screen will show the Supabase project's address, which is acceptable here.

Free-plan limits that matter:

- Supabase pauses a project after a week with no activity, and it can be restored from the dashboard with its data intact. Free plan allows two active projects.
- Mapbox allows about 50,000 map loads a month for free, far beyond this use. The owner's account has a card on it, so loads past that are billed automatically with no spending cap. The owner accepts this small risk, reduced by the URL-restricted token. Set a usage notification in the Mapbox console during step 5.

**Shutting down:** delete the Vercel project and Supabase project, revoke the Mapbox token, and delete the Google OAuth client. The steps go in the README.

## Order of work

Each step ends with `lint`, `typecheck` and `test` passing and the app working locally. Steps are done in this order because Mapbox is the riskiest: a failure there still leaves a working, deployed app on Leaflet.

1. **Supabase data:** migrations, `SupabaseChatRepository`, RPC functions.
2. **Live messages:** Supabase Realtime, removing the server's streaming code.
3. **Google sign-in:** auth, row-level security, chat card changes, removing rate limits and the username field. The owner creates the Google OAuth client here and tries real sign-in locally, including the return to a room and to a draft.
4. **Vercel:** deploy with Leaflet, creating the hosted Supabase project and repeating the by-hand Google sign-in on the public link. While the app runs on Leaflet, the deployed map keeps using OpenStreetMap's public tiles, which allow light use.
5. **Mapbox.**

Steps 1 and 2 leave the app with v1's open posting until step 3, so nothing is deployed before step 4.

The plan splits these steps into tasks: step 1 is Tasks 1 and 2, step 2 is Task 3, step 3 is Tasks 4 to 6, step 4 is Task 7, and step 5 is Tasks 8 and 9.

## Testing

- **Local:** Unit and API tests run against a local Supabase (`supabase start`, which runs on Docker). The Supabase CLI is a new dev tool, and `@supabase/supabase-js`, `@supabase/ssr` and `react-map-gl` with `mapbox-gl` are new dependencies, approved by this design. `docker-compose.yml` and the shared-Postgres setup are removed from this branch.
- **New tests:** the name function, row-level security (a signed-out insert fails, an insert for someone else fails, a sent `author` is overwritten, and changing one's own metadata with `updateUser` does not change the posted name), and the 401s.
- **End-to-end:** Google's sign-in screen cannot be automated, so Playwright signs in a seeded password user directly against local Supabase and sets the session cookie in the browser. The seed writes that user's name into `auth.identities.identity_data`, so the same name function runs. The app contains no test-only login code. Password sign-in stays off in the hosted project. Tests that drop the SSE stream or `LISTEN` connection are rewritten or removed along with that code.
- **Map:** the Leaflet-specific e2e tests are updated at step 5. Mapbox needs WebGL, so confirm it runs in headless Chromium. Tests must not use up map loads against the free allowance needlessly, and CI runs without a real token if the map can be stubbed. Decide how at the start of step 5, since every Playwright page load would otherwise count.
- **CI:** the `docker` job and shutdown check are removed. The `checks` job starts local Supabase in place of the Postgres service.
- **By hand after deploy:** real Google sign-in on desktop and phone, two browsers seeing a message live, and return-to-pin after sign-in.

## Left to the builder

File layout inside the Supabase modules, the exact wording of errors, the mobile presentation of the sign-in prompt (same content in the sheet), and how `Message` conversion is shared between the repository and live delivery.
