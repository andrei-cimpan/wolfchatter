import { test as base, expect, type Page, type WebSocketRoute } from "@playwright/test";

// The browser logs every non-2xx response, and some tests trigger a 404, 429 or 500 on purpose.
const EXPECTED_CONSOLE_ERRORS = [/^Failed to load resource: the server responded with a status of (404|429|500)/];

/**
 * Fails any test whose page throws or logs a console error, such as React's hydration mismatch,
 * which otherwise only shows in the dev server log while the test passes.
 */
export const test = base.extend<{ failOnBrowserErrors: void; ownRoomsOnly: boolean; hideOtherRooms: void }>({
  /**
   * The e2e database is emptied once per run, not per test, and tests click the same spots, so
   * each would see (and cluster with) the others' rooms. By default a test's map shows only the
   * rooms its own page created. Tests about viewport loading turn this off.
   */
  ownRoomsOnly: [true, { option: true }],
  hideOtherRooms: [
    async ({ page, ownRoomsOnly }, use) => {
      if (ownRoomsOnly) await showOnlyOwnRooms(page);
      await use();
      // A viewport request can still be in flight when a test ends; its route.fetch would then throw.
      if (ownRoomsOnly) await page.unrouteAll({ behavior: "ignoreErrors" });
    },
    { auto: true },
  ],
  failOnBrowserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (!EXPECTED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) errors.push(`console.error: ${text}`);
      });
      await use();
      expect(errors, "browser errors during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

type OwnRoom = { id: string; title: string; lat: number; lng: number; messageCount: number };

// Registered before each test's own routes, so those run first and reach these only when they
// fall back; a test that fakes a POST response therefore never records a room here.
async function showOnlyOwnRooms(page: Page): Promise<void> {
  const ownRooms: OwnRoom[] = [];
  await page.route(
    (url) => url.pathname === "/api/rooms",
    async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      if (route.request().method() === "POST") {
        // Recorded before the browser sees the room, so the refetch it triggers already has it.
        ownRooms.push((await response.json()) as OwnRoom);
        return route.fulfill({ response });
      }
      // The server's answer is replaced, not filtered: it may have clustered one of this test's
      // rooms with another test's. Rooms outside the viewport are harmless, Leaflet just draws them off-screen.
      const json = ownRooms.map(({ id, title, lat, lng, messageCount }) => ({ type: "room", id, title, lat, lng, messageCount }));
      return route.fulfill({ response, json });
    },
  );
}

/** Zoom levels of the tiles on screen; tile URLs end in /{z}/{x}/{y}.png. The map opens at 5. */
export function tileZooms(page: Page) {
  return page
    .locator(".leaflet-tile")
    .evaluateAll((tiles) => [
      ...new Set(tiles.map((t) => new URL((t as HTMLImageElement).src).pathname.split("/")[1])),
    ]);
}

// A 1x1 PNG served for every off-site image, whichever basemap the dev server is configured with:
// the tests stay offline and off tile providers' servers (whose policies forbid automated load),
// yet the map still has real tiles that could cover the panel.
const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export async function serveBlankTiles(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const request = route.request();
    const offSite = new URL(request.url()).hostname !== "localhost";
    return request.resourceType() === "image" && offSite
      ? route.fulfill({ contentType: "image/png", body: BLANK_TILE })
      : route.fallback();
  });
}

/** Leaflet makes tiles ignore the pointer, which would hide them from elementFromPoint. */
export async function makeTilesHitTestable(page: Page): Promise<void> {
  await page.addStyleTag({ content: ".leaflet-tile { pointer-events: auto !important; }" });
}

export async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} is not visible`);
  return b;
}

type LiveConnection = {
  /** How many of this room's channels Realtime has reported as live (postgres_changes running). */
  readyCount(roomId: string): number;
  /** This room's channels that are live now: reported live, and not left or cut off since. */
  liveChannels(roomId: string): number;
  /** Waits until the room has one live channel, reported after the first `after` of them. */
  ready(roomId: string, options?: { after?: number }): Promise<void>;
  /** Closes the open Realtime sockets, as a dropped network would; the client then reconnects. */
  drop(): Promise<void>;
  /** While down, the page's Realtime sockets are closed as soon as they open. */
  setDown(down: boolean): void;
  /** Sockets refused while down. */
  refused(): number;
};

type Frame = { topic: string; event: string; payload: unknown };

// Realtime frames are JSON arrays [join_ref, ref, topic, event, payload] (protocol 2.0.0) or objects
// with those fields (1.0.0); anything else, such as binary broadcast, is not a channel event here.
function parseFrame(message: string | Buffer): Frame | null {
  if (typeof message !== "string") return null;
  try {
    const value: unknown = JSON.parse(message);
    if (Array.isArray(value)) return { topic: String(value[2]), event: String(value[3]), payload: value[4] };
    if (value && typeof value === "object" && "topic" in value && "event" in value) {
      const { topic, event, payload } = value as { topic: unknown; event: unknown; payload?: unknown };
      return { topic: String(topic), event: String(event), payload };
    }
  } catch {
    // Not JSON: not a channel event.
  }
  return null;
}

function isPostgresChangesOk(frame: Frame): boolean {
  if (frame.event !== "system" || !frame.payload || typeof frame.payload !== "object") return false;
  const { extension, status } = frame.payload as { extension?: unknown; status?: unknown };
  return extension === "postgres_changes" && status === "ok";
}

/**
 * Routes the page's Realtime WebSocket through the test, which then sees when a room's channel is
 * live and can drop the connection. Call it before the page opens a room. A channel counts as live
 * from Realtime's `system` message, the one subscribeToRoomMessages waits for, not from the join
 * reply, which comes first. Dev mode's StrictMode subscribes, leaves and subscribes again on mount,
 * so tests count live channels rather than messages.
 */
export async function watchLiveConnection(page: Page): Promise<LiveConnection> {
  const readyTopics = new Set<string>();
  const endedTopics = new Set<string>();
  let open: { ws: WebSocketRoute; topics: Set<string> }[] = [];
  let down = false;
  let refused = 0;
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (down) {
      refused++;
      return ws.close();
    }
    const server = ws.connectToServer();
    const socket = { ws, topics: new Set<string>() };
    open.push(socket);
    ws.onMessage((message) => {
      const frame = parseFrame(message);
      if (frame?.event === "phx_leave") endedTopics.add(frame.topic);
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = parseFrame(message);
      if (frame && isPostgresChangesOk(frame)) {
        readyTopics.add(frame.topic);
        socket.topics.add(frame.topic);
      }
      ws.send(message);
    });
    // A closed socket ends its channels, whichever side closed it.
    const endAll = () => socket.topics.forEach((topic) => endedTopics.add(topic));
    ws.onClose(() => {
      endAll();
      void server.close();
    });
    server.onClose(() => {
      endAll();
      void ws.close();
    });
  });
  const ofRoom = (topics: Iterable<string>, roomId: string) => [...topics].filter((topic) => topic.includes(roomId));
  const readyCount = (roomId: string) => ofRoom(readyTopics, roomId).length;
  const liveChannels = (roomId: string) => ofRoom(readyTopics, roomId).filter((t) => !endedTopics.has(t)).length;
  return {
    readyCount,
    liveChannels,
    ready: (roomId, { after = 0 } = {}) =>
      expect
        .poll(() => readyCount(roomId) > after && liveChannels(roomId) === 1, {
          message: `room ${roomId} live (after ${after})`,
          timeout: 15_000,
        })
        .toBe(true),
    drop: async () => {
      const closing = open;
      open = [];
      await Promise.all(closing.map(({ ws }) => ws.close()));
    },
    setDown: (value) => {
      down = value;
    },
    refused: () => refused,
  };
}
