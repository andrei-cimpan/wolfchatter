import { test as base, expect, type Page } from "@playwright/test";
import pg from "pg";

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

/**
 * Ends the app server's LISTEN connection, as a database restart or a dropped network would. The
 * hub then closes every stream, and the source reconnects after its 1 s backoff, so messages
 * posted right after this never reach a stream and arrive only through catch-up.
 */
export async function dropRealtimeListener(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = current_database() and application_name = 'wolfchatter-realtime'`,
    );
    expect(rowCount, "the app's LISTEN connection").toBe(1);
  } finally {
    await client.end();
  }
}
