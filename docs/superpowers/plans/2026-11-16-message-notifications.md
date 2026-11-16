# New-message notifications (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When someone else posts in the room you have open, you hear a short bell-like "ding". If the tab is in front of you, that is all. If the tab is hidden or the window is not focused, you also get a system notification ("Ana P. in <room title>" plus the start of the message). Clicking it brings you back to the room. Your own messages never trigger anything.

**Architecture:** Hidden tabs stop dropping their Realtime channel. The Realtime heartbeat runs in a Web Worker (`realtime: { worker: true }`, a feature built into supabase-js with an inline blob script, so nothing is fetched from elsewhere), so background throttling can't starve it. The stream passes each live message's poster id along, and the browser's own session supplies yours, so the client can skip its own messages. A small pure function picks what happens: nothing, ding, or ding plus notification. The ding is synthesized with the Web Audio API: no audio file and no dependency. A bell toggle in the room header turns it all on, and turning it on is the click that asks the browser for permission and unlocks audio.

**Tech Stack:** what v2 already uses. No new dependency.

**Spec:** this plan; the owner agreed to the behaviour in chat on 2026-11-16 (tab in front: ding only; tab in the background: notification plus ding; own messages: nothing).

## Global Constraints

- Only on `v2`. One branch, `feat/v2-message-notifications`, one PR against `v2`; the owner merges.
- Every shell starts with `nvm use`. Docker is at `/Users/andreicimpan/.docker/bin/docker`.
- Done when `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e` pass and CI is green. PRD, DESIGN and TASKS are updated in the same commits as the code they describe.
- No migration is needed: `messages` is already published, and `user_id` is already in every Realtime row.
- We don't ship Apple's sound file. The ding is our own synthesized tone, meant to evoke a short bright bell, not to copy one.
- UI copy, exactly: "Turn on notifications", "Turn off notifications", and as the blocked hint "Notifications are blocked in your browser's settings. You'll still hear the ding."

## Calls I made (the owner may overrule any of these)

1. **Off by default; one bell toggle per browser.** Browsers only allow a permission prompt and audio after a click, so the toggle is that click. The preference is saved in localStorage (`wolfchatter:notify`) and applies to every room. Without it, nobody would hear anything until they had clicked something anyway.
2. **The ding works even without notification permission.** If the browser blocks notifications, or has none (iPhone Safari outside an installed web app), the toggle still turns on the ding and shows the blocked hint.
3. **"In front of you" means visible *and* focused** (`document.visibilityState === "visible" && document.hasFocus()`). A visible window behind another app counts as the background, so it gets the notification.
4. **Only live messages alert.** Messages fetched on catch-up after a dropped connection are added silently; a burst of old dings would be noise.
5. **One notification per room** (`tag: roomId`), so a busy room replaces its notification instead of stacking them. The notification is `silent: true`, because we play our own ding.
6. **Hidden tabs always stay connected**, whether notifications are on or off. That is simpler than two modes. It costs one idle socket per open background tab, which is fine for a small userbase.
7. **Not covered: closed tabs, locked phones, Android Chrome system notifications.** Those need a service worker and Web Push, a much bigger feature. On Android Chrome the `Notification` constructor throws. We catch that and still play the ding.

## Review Focus

- Your own message, arriving over Realtime before or after the POST response, in this tab or in another tab of yours: no ding, no notification.
- A message in a room other than the one open: nothing (the stream already filters these; make sure the alert path does too).
- A hidden tab for 10+ minutes, then a message: delivered live and alerted. If the socket died anyway, it reconnects and catches up silently.
- Turning the toggle on when the permission is "denied" or `Notification` is undefined: the ding still works, and the hint is shown.
- Body text in the notification is plain text and cut at 100 characters; nothing user-written reaches HTML.

---

### Task 1: Keep hidden tabs connected

**Files:** `src/lib/room-stream.ts`, `src/lib/room-stream.test.ts`, `src/lib/supabase/browser-client.ts`, `docs/DESIGN.md` (Real-time delivery, step 4)

- [ ] **Step 1: Failing test.** In `room-stream.test.ts`, replace the hidden-tab tests with: "keeps its channel while the page is hidden". A fake page goes hidden, `subscribe`'s unsubscribe is not called, and a message still reaches `onMessage`. Run it: `npm test -- room-stream`. Expected: FAIL (the channel is dropped).
- [ ] **Step 2: Implement.** Remove the `PageVisibility` option, the visibility listener and the `hidden` checks from `connectRoomStream`. Rewrite its doc comment: the heartbeat runs in a worker, so a background tab keeps its channel, and a socket that dies anyway fails the channel, which then retries and catches up. In `getBrowserSupabase`, pass `{ realtime: { worker: true } }` to `createBrowserClient`, with a why-comment.
- [ ] **Step 3: Run** `npm test -- room-stream` and `npm run typecheck`. Expected: PASS. Update DESIGN's "A hidden tab holds no channel…" sentence in the same commit.
- [ ] **Step 4: e2e check.** `npm run e2e -- messages room-deletion`. Expected: PASS. If a test relied on a hidden tab dropping its channel, rewrite it to the new behaviour and note that in the commit.
- [ ] **Step 5: Commit** `feat: keep a hidden tab's room channel open`.

### Task 2: Know who posted a live message

**Files:** `src/lib/message-row.ts`, `src/lib/room-stream.ts` (+ test), `src/hooks/useMyUserId.ts`, `docs/DESIGN.md` (Real-time)

`/api/me` cannot give the id without a migration (the name comes from the `current_author_name()` RPC, and `auth.uid()` is not callable through PostgREST). The browser's own session already holds it, and `useCurrentUser` already listens to that session. Only own-message skipping depends on it, so a stale or forged id costs at most a missed or extra ding.

- [ ] **Step 1: Failing test.** In `room-stream.test.ts`: `onMessage(message, posterId)` gets the row's `user_id`. Run `npm test -- room-stream`. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - Add `user_id: string` to `MessageRow`, and leave `messageFromRow` unchanged: `Message` gets no user id, so the API serves no more than before (see T8.4).
  - `connectRoomStream` calls `handlers.onMessage(message, row.user_id)`.
  - `useMyUserId()` keeps `session?.user.id ?? null` from `getBrowserSupabase().auth.onAuthStateChange`, which fires `INITIAL_SESSION` on load. It reads the session, never chat data, so it stays within the rule for the browser client.
- [ ] **Step 3: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 4: Commit** `feat: tell the client who posted each live message`.

### Task 3: The ding

**Files:** `src/lib/ding.ts`, `src/lib/ding.test.ts`

- [ ] **Step 1: Failing test.** Using a fake `AudioContext` passed in:
  - `createDing(factory)` makes no context until `unlock()`. Browsers refuse audio started without a click.
  - `unlock()` resumes the context.
  - `play()` before unlock does nothing.
  - `play()` after unlock starts two oscillators (base tone and overtone) through one gain node that rises in ≤ 5 ms and decays exponentially to near silence over about 0.9 s.
  - Two `play()` calls within 150 ms play once.

  Expected: FAIL (no module).
- [ ] **Step 2: Implement.** A bright bell-like tone: sine partials at about 1568 Hz (G6) and 2× that, the overtone at a third of the volume, peak gain 0.25. Keep one module-level instance for the app (`getDing()`). Comments explain the gesture rule and the debounce (a burst of messages gives one ding, not a chord).
- [ ] **Step 3: Listen.** Run the app (`npm run dev`), turn the toggle on in Task 5, and have the owner judge the sound. Tune the frequencies and decay if asked; the test pins the shape, not the exact notes.
- [ ] **Step 4: Run** `npm test -- ding`. Expected: PASS. **Commit** `feat: synthesize a short notification ding`.

### Task 4: Deciding and showing the alert

**Files:** `src/lib/message-alert.ts`, `src/lib/message-alert.test.ts`, `src/hooks/useRoomStream.ts`

- [ ] **Step 1: Failing tests** for a pure `alertFor({ posterId, myId, enabled, inFront })`:
  - returns `"none"` when disabled or when the poster is you;
  - returns `"ding"` when in front;
  - otherwise returns `"notify"`.

  Then tests for `showAlert(kind, message, roomTitle, deps)` with fakes:
  - `"notify"` plays the ding and creates `Notification("Ana P. in <title>", { body: <first 100 chars, "…" if cut>, tag: roomId, silent: true })` only when permission is `"granted"`;
  - a throwing constructor (Android) still dings;
  - clicking the notification calls `window.focus()` and closes it.

  Expected: FAIL.
- [ ] **Step 2: Implement.** `useRoomStream` gets `onMessage(message, posterId)`. It still calls `addMessage`, then `showAlert(alertFor(…), …)`. The user id comes from `useMyUserId`, the room title from the cached room query, and `enabled` from the preference (Task 5). `inFront` is read at the moment the message arrives. Catch-up does not go through this path (call 4).
- [ ] **Step 3: Run** `npm test`. Expected: PASS. **Commit** `feat: ding or notify on a new message from someone else`.

### Task 5: The bell toggle

**Files:** `src/lib/notify-preference.ts` (+ test), `src/hooks/useNotifyPreference.ts`, `src/components/NotifyToggle.tsx`, `src/components/RoomPanel.tsx`, `e2e/notifications.spec.ts`, `docs/PRD.md` (FR10), `docs/DESIGN.md` (UI behavior + Real-time), `docs/TASKS.md` (T8.11)

- [ ] **Step 1: Failing unit test** for `notify-preference.ts`: it reads and writes `wolfchatter:notify`, a blocked localStorage reads as off and writes do nothing, and it notifies subscribers when another tab changes it (`storage` event), so `useSyncExternalStore` can use it.
- [ ] **Step 2: Failing e2e** (`e2e/notifications.spec.ts`). An init script records `new Notification(...)` calls and dings (by stubbing `AudioContext`) and lets the test set `document.hasFocus` and `visibilityState`. Tests:
  1. Off by default: another user's message gives no ding and no notification.
  2. Turning the toggle on with permission granted (`context.grantPermissions(["notifications"])`), page in front: another user's message gives one ding and no notification.
  3. Page in the background: one ding plus one notification with the author, the room title and the body.
  4. Your own message, in the front or the background: nothing.
  5. Permission denied: the blocked hint shows, and a message still dings.
  6. The toggle survives a reload and turns off again.
  7. Layout: the toggle fits beside the title on desktop and in the sheet header on a phone, with no horizontal overflow at 300×260 (the case that bit room deletion).

  Expected: FAIL.
- [ ] **Step 3: Implement** `NotifyToggle`:
  - a 44 px icon button with `aria-pressed` and an `aria-label` from the UI copy, and an inline bell SVG;
  - on turn-on, call `getDing().unlock()`, then `Notification.requestPermission()` if it is "default";
  - show the blocked hint when the permission is "denied" or `Notification` is missing.

  Place it like `DeleteRoomButton`: in the title row on md and up, in the sheet header below md, next to Delete, and only for a real room (not a draft or a closed room). It is shown signed in or out: reading needs no account, and a signed-out reader has no "own messages" to skip.
- [ ] **Step 4: Run** `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e`. Expected: PASS. Update PRD (new FR10), DESIGN and TASKS (T8.11, ticked) in this commit. **Commit** `feat: bell toggle for new-message notifications`.

### Task 6: PR, review, live check

- [ ] Push the branch and open the PR against `v2`. Wait for CI to go green.
- [ ] Fresh-agent review in a worktree. Verify each finding, make one fix commit per finding ("(review #N)"), then remove the worktree.
- [ ] After the owner merges, check it on https://mapchat.cgatechnologies.ro with two browsers: one ding in front, a notification in the background, nothing for your own message.
