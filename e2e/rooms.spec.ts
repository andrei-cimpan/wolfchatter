import type { Page } from "@playwright/test";
import { box, expect, makeTilesHitTestable, serveBlankTiles, test, tileZooms } from "./support";

const ROOM_URL = /\?room=[0-9a-f-]{36}$/;
const ROOM_TITLE = /^Chatroom \d+$/;

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

async function openMap(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".leaflet-container")).toBeVisible();
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Chat" });
const roomTitle = (page: Page) => panel(page).getByRole("heading", { level: 2 });
const pin = (page: Page, title: string) => page.getByRole("button", { name: title, exact: true });

/** Clicks the map at a point inside it and returns the new room's title once the panel shows it. */
async function createRoomAt(page: Page, x: number, y: number): Promise<string> {
  const before = page.url();
  await page.locator(".leaflet-container").click({ position: { x, y } });
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(ROOM_URL);
  await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
  return (await roomTitle(page).textContent()) ?? "";
}

/** Where the selected room's pin ends up on a 1280 px view: centred in the map left of the card. */
const CARD_FOCUS_X = (1280 - 396) / 2;

async function postRoom(page: Page, position: { lat: number; lng: number }) {
  const response = await page.request.post("/api/rooms", { data: position });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; title: string };
}

/** Waits for the flight to end with the pin's tip (12 px in, at the icon's foot) on this point. */
async function expectPinTipAt(page: Page, title: string, point: { x: number; y: number }) {
  await expect(async () => {
    const icon = await pin(page, title).boundingBox();
    expect(Math.abs((icon?.x ?? 0) + 12 - point.x)).toBeLessThan(3);
    expect(Math.abs((icon?.y ?? 0) + 41 - point.y)).toBeLessThan(3);
  }).toPass({ timeout: 10_000 });
}

/** At a whole zoom every tile is 256 px wide; a zoom left between levels scales them and blurs the map. */
async function expectWholeZoom(page: Page) {
  await expect
    .poll(
      () => page.locator(".leaflet-tile").evaluateAll((tiles) => [...new Set(tiles.map((t) => t.getBoundingClientRect().width))]),
      { timeout: 5000 },
    )
    .toEqual([256]);
}

async function expectZoomKept(page: Page) {
  await expectWholeZoom(page);
  expect(await tileZooms(page)).toEqual(["5"]);
}

/** Next keeps useSearchParams in sync with pushState, which is how the app selects a room. */
function selectInPage(page: Page, id: string) {
  return page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), id);
}

/** Pausing before the release means no inertia, so the drag's moveend comes right at mouse up. */
async function dragWithoutInertia(page: Page) {
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 320, { steps: 4 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

/**
 * The x of a pin's centre on each animation frame for the next 1.5 s, in the order seen. Without a
 * title, any pin: the first the map shows, which suits a test whose room does not exist yet.
 */
function trackPinX(page: Page, title?: string): Promise<number[]> {
  return page.evaluate(
    ({ title, ms }) =>
      new Promise<number[]>((resolve) => {
        const xs: number[] = [];
        const end = performance.now() + ms;
        const sample = () => {
          const selector = title ? `.leaflet-marker-icon[title="${title}"]` : ".leaflet-marker-icon";
          const icon = document.querySelector(selector);
          if (icon) {
            const { x, width } = icon.getBoundingClientRect();
            xs.push(x + width / 2);
          }
          if (performance.now() < end) requestAnimationFrame(sample);
          else resolve(xs);
        };
        sample();
      }),
    { title, ms: 1500 },
  );
}

function countRoomPosts(page: Page) {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/rooms") {
      posts.push(request.url());
    }
  });
  return posts;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("clicking the map creates a room, drops a pin and opens the room", async ({ page }) => {
    await openMap(page);
    const title = await createRoomAt(page, 400, 300);
    await expect(pin(page, title)).toBeVisible();
    await expect(panel(page)).toContainText("No messages yet");
    await expect(panel(page)).not.toContainText("Click on the map to start a chat");
  });

  test("a second click makes a second room; pins and Back switch between them", async ({ page }) => {
    await openMap(page);
    const first = await createRoomAt(page, 400, 300);
    const firstUrl = page.url();
    const second = await createRoomAt(page, 600, 450);
    expect(second).not.toBe(first);
    await expect(pin(page, first)).toBeVisible();
    await expect(pin(page, second)).toBeVisible();

    await pin(page, first).click();
    await expect(roomTitle(page)).toHaveText(first);
    await expect(page).toHaveURL(firstUrl);

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(second);
  });

  test("a room created on a repeated copy of the world gets its pin where the click was", async ({
    page,
  }) => {
    await openMap(page);
    // From zoom 5 to 1: at 1280 px the view then spans more than one world, so x=1150 lies on
    // the copy east of the antimeridian (longitude above 180).
    for (const zoom of [4, 3, 2, 1]) {
      await page.getByRole("button", { name: "Zoom out" }).click();
      // Each click is ignored while the previous zoom animates, so wait for its tiles.
      await expect.poll(() => tileZooms(page)).toEqual([String(zoom)]);
    }
    await page.waitForTimeout(400);

    const track = trackPinX(page);
    const title = await createRoomAt(page, 1150, 300);
    const xs = await track;
    // The pin appears where the click was and flies from there. A hop to another copy of the
    // world would jump a whole world, 512 px at this zoom.
    expect(Math.abs((xs[0] ?? 0) - 1150)).toBeLessThan(40);
    for (let i = 1; i < xs.length; i++) expect(Math.abs((xs[i] ?? 0) - (xs[i - 1] ?? 0))).toBeLessThan(300);
    await expectPinTipAt(page, title, { x: CARD_FOCUS_X, y: 360 });
  });

  test("the map flies to a new room, keeping its pin clear of the card", async ({ page }) => {
    await openMap(page);
    const title = await createRoomAt(page, 100, 600);
    await expectPinTipAt(page, title, { x: CARD_FOCUS_X, y: 360 });
  });

  test("a room link opens on the room, without a flight from the default view", async ({ page }) => {
    const room = await postRoom(page, { lat: -33.87, lng: 151.2 });
    await openMap(page, `/?room=${room.id}`);
    await expect(pin(page, room.title)).toBeAttached();
    // The pin appears and the map moves in one commit, so a flight would still be moving it here.
    expect(new Set(await trackPinX(page, room.title)).size).toBe(1);
    await expectPinTipAt(page, room.title, { x: CARD_FOCUS_X, y: 360 });
  });

  test("Back flies to the previous room", async ({ page }) => {
    const room = await postRoom(page, { lat: -33.87, lng: 151.2 });
    await openMap(page, `/?room=${room.id}`);
    await expectPinTipAt(page, room.title, { x: CARD_FOCUS_X, y: 360 });

    const created = await createRoomAt(page, 100, 600);
    await expectPinTipAt(page, created, { x: CARD_FOCUS_X, y: 360 });
    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    await expectPinTipAt(page, room.title, { x: CARD_FOCUS_X, y: 360 });
  });

  test("selecting a room flies there, and with reduced motion jumps instead", async ({ page }) => {
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    await openMap(page);
    // Next keeps useSearchParams in sync with pushState, which is how the app selects a room.
    const select = (id: string) => page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), id);

    const flight = trackPinX(page);
    await select(far.id);
    expect(new Set(await flight).size).toBeGreaterThan(5);
    await expectPinTipAt(page, far.title, { x: CARD_FOCUS_X, y: 360 });

    const near = await postRoom(page, { lat: 48, lng: 20 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const jump = trackPinX(page, near.title);
    await select(near.id);
    expect(new Set(await jump).size).toBeLessThanOrEqual(2);
    await expectPinTipAt(page, near.title, { x: CARD_FOCUS_X, y: 360 });
  });

  test("dragging during a flight stops it where the user left the map", async ({ page }) => {
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    await openMap(page);
    await page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), far.id);
    await expect(pin(page, far.title)).toBeAttached();
    // Long enough for the flight to have zoomed out part of the way.
    await page.waitForTimeout(500);

    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(340, 320, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    // The flight would have ended with the pin at the focus point.
    const icon = await pin(page, far.title).boundingBox();
    const tip = { x: (icon?.x ?? 0) + 12, y: (icon?.y ?? 0) + 41 };
    expect(Math.abs(tip.x - CARD_FOCUS_X) + Math.abs(tip.y - 360)).toBeGreaterThan(50);
    await expectZoomKept(page);
  });

  test("selecting another room during a flight keeps the zoom", async ({ page }) => {
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    const near = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page);
    const select = (id: string) => page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), id);

    await select(far.id);
    await expect(pin(page, far.title)).toBeAttached();
    await page.waitForTimeout(500);
    await select(near.id);
    await expectPinTipAt(page, near.title, { x: CARD_FOCUS_X, y: 360 });
    await expectZoomKept(page);
  });

  test("a flight started during a zoom animation still ends on a whole zoom when dragged", async ({ page }) => {
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    const near = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page);
    // Visited first so both are cached: the flight below must start inside the zoom's 250 ms.
    await selectInPage(page, far.id);
    await expectPinTipAt(page, far.title, { x: CARD_FOCUS_X, y: 360 });
    await selectInPage(page, near.id);
    await expectPinTipAt(page, near.title, { x: CARD_FOCUS_X, y: 360 });

    await page.evaluate((room) => {
      document.querySelector<HTMLElement>(".leaflet-control-zoom-out")?.click();
      history.pushState(null, "", `/?room=${room}`);
    }, far.id);
    await page.waitForTimeout(700);
    await dragWithoutInertia(page);
    await expectWholeZoom(page);
  });

  test("selecting again just after a drag stopped a flight still ends on a whole zoom", async ({ page }) => {
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    const other = await postRoom(page, { lat: 60, lng: -100 });
    await openMap(page);
    await selectInPage(page, far.id);
    await page.waitForTimeout(700);
    await dragWithoutInertia(page);
    // Inside the 250 ms in which the drag's zoom restore is animating.
    await page.waitForTimeout(50);
    await selectInPage(page, other.id);
    await page.waitForTimeout(700);
    await dragWithoutInertia(page);
    await expectWholeZoom(page);
    expect(await tileZooms(page)).toEqual(["5"]);
  });

  test("zooming during a flight is not undone by a later flight", async ({ page }) => {
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    const near = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page);
    await selectInPage(page, near.id);
    await expectPinTipAt(page, near.title, { x: CARD_FOCUS_X, y: 360 });

    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(() => tileZooms(page)).toEqual(["4"]);
    await page.waitForTimeout(400);
    await selectInPage(page, far.id);
    await expectPinTipAt(page, far.title, { x: CARD_FOCUS_X, y: 360 });
    await expectWholeZoom(page);
    expect(await tileZooms(page)).toEqual(["4"]);
  });

  test("two rooms created in quick succession keep the zoom", async ({ page }) => {
    await openMap(page);
    await expect(page.locator(".leaflet-tile").first()).toBeAttached();
    await createRoomAt(page, 100, 600);
    const second = await createRoomAt(page, 800, 100);
    await expectPinTipAt(page, second, { x: CARD_FOCUS_X, y: 360 });
    await expectZoomKept(page);
  });

  test("dragging the map does not create a room", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(650, 450, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(0);
    await expect(panel(page)).toHaveText("Click on the map to start a chat");
  });

  test("double-clicking creates one room, not two, and does not zoom", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);

    await page.locator(".leaflet-container").dblclick({ position: { x: 500, y: 400 } });
    await expect(page).toHaveURL(ROOM_URL);
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(1);
    expect(await tileZooms(page)).toEqual(["5"]);
  });

  test("clicks while a room is still being created are ignored", async ({ page }) => {
    const posts = countRoomPosts(page);
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await page.mouse.click(400, 300);
    await expect(panel(page).getByRole("status")).toHaveText("Creating a chatroom…");
    await page.mouse.click(600, 450);
    await expect(page).toHaveURL(ROOM_URL);
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(1);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  });

  test("picking a pin while a room is being created keeps that pick, and creating still works", async ({
    page,
  }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    const first = await createRoomAt(page, 400, 300);
    const firstUrl = page.url();

    let slow = true;
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST" && slow) await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/rooms",
    );
    await page.mouse.click(600, 450);
    // The open room may still be loading its messages, which is a status of its own.
    await expect(panel(page).getByRole("status").filter({ hasText: "Creating a chatroom…" })).toBeVisible();
    await pin(page, first).click();
    await created;
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(firstUrl);
    await expect(roomTitle(page)).toHaveText(first);

    slow = false;
    await createRoomAt(page, 800, 550);
    expect(posts).toHaveLength(3);
  });

  test("a focused pin opens its room with Enter or Space", async ({ page }) => {
    await openMap(page);
    const first = await createRoomAt(page, 400, 300);
    const second = await createRoomAt(page, 600, 450);

    await pin(page, first).focus();
    await page.keyboard.press("Enter");
    await expect(roomTitle(page)).toHaveText(first);

    await pin(page, second).focus();
    await page.keyboard.press("Space");
    await expect(roomTitle(page)).toHaveText(second);
  });

  test("clicking the selected pin again adds no history entry", async ({ page }) => {
    await openMap(page);
    const title = await createRoomAt(page, 400, 300);
    const before = await page.evaluate(() => history.length);
    await pin(page, title).click();
    await pin(page, title).click();
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test("a creation error goes away when the selection changes", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } })
        : route.fallback(),
    );
    await page.mouse.click(600, 450);
    await expect(panel(page).getByRole("alert")).toHaveText("Couldn't create the chatroom. Please try again.");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  });

  test("the second click of a slow double-click creates nothing", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await page.mouse.click(500, 400);
    await expect(page).toHaveURL(ROOM_URL);
    // The first room is already made; this is the second click of the same double-click
    // (detail 2), just below the new pin's tip so it lands on the map rather than the pin.
    await page.mouse.move(500, 404);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(1);
  });

  test("a rate-limited click explains the wait and creates nothing", async ({ page }) => {
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 429,
            headers: { "Retry-After": "30" },
            json: { error: { code: "rate_limited", message: "Too many requests" } },
          })
        : route.fallback(),
    );
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 400, y: 300 } });
    await expect(panel(page).getByRole("alert")).toHaveText(
      "You're creating chatrooms too quickly. Try again in 30 seconds.",
    );
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(0);
  });

  test("a room that fails to load says so within a few seconds", async ({ page }) => {
    await page.route("**/api/rooms/*", (route) =>
      route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } }),
    );
    await openMap(page, "/?room=00000000-0000-4000-8000-000000000000");
    await expect(panel(page).getByRole("alert")).toHaveText(
      "Couldn't load this chatroom. Please try again.",
      { timeout: 3000 },
    );
  });

  test("an unknown or malformed room id shows that the room does not exist", async ({ page }) => {
    await openMap(page, "/?room=00000000-0000-4000-8000-000000000000");
    await expect(panel(page)).toContainText("This chatroom doesn't exist.");

    const roomRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/rooms/")) roomRequests.push(request.url());
    });
    await openMap(page, "/?room=not-a-room");
    await expect(panel(page)).toContainText("This chatroom doesn't exist.");
    expect(roomRequests).toHaveLength(0);
  });
});

test.describe("just wide enough for the card", () => {
  test.use({ viewport: { width: 800, height: 720 } });

  test("a room selected at zoom 0 stays clear of the card", async ({ page }) => {
    const room = await postRoom(page, { lat: -33.87, lng: 151.2 });
    await openMap(page);
    for (const zoom of [4, 3, 2, 1, 0]) {
      await page.getByRole("button", { name: "Zoom out" }).click();
      await expect.poll(() => tileZooms(page)).toEqual([String(zoom)]);
    }
    await page.waitForTimeout(400);

    await page.evaluate((id) => history.pushState(null, "", `/?room=${id}`), room.id);
    await expect(pin(page, room.title)).toBeAttached();
    // Half the 800 px view, less the shift: at zoom 0 the 256 px world allows 127 px of it.
    await expectPinTipAt(page, room.title, { x: 400 - 127, y: 360 });
    await page.waitForTimeout(500);
    await expectPinTipAt(page, room.title, { x: 400 - 127, y: 360 });
  });
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("opening a room raises the sheet; closing it lowers the sheet and refills the map", async ({
    page,
  }) => {
    await openMap(page);
    await createRoomAt(page, 180, 250);

    const sheet = await box(page, "aside");
    expect(sheet.height).toBeCloseTo(667 / 2, 0);
    expect(sheet.y + sheet.height).toBe(667);
    const map = await box(page, ".leaflet-container");
    expect(map.y + map.height).toBeLessThanOrEqual(sheet.y);

    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText("Click on the map to start a chat");
    expect((await box(page, ".leaflet-container")).height).toBeGreaterThan(map.height);
  });

  test("a room created near the bottom of the map stays in the part left visible by the sheet", async ({
    page,
  }) => {
    await openMap(page);
    const title = await createRoomAt(page, 300, 570);
    const map = await box(page, ".leaflet-container");
    await expectPinTipAt(page, title, { x: 375 / 2, y: map.y + map.height / 2 });
  });

  test("a map that starts beside a raised sheet fills in when the sheet closes", async ({ page }) => {
    const response = await page.request.post("/api/rooms", { data: { lat: 48, lng: 20 } });
    const { id } = (await response.json()) as { id: string };
    await openMap(page, `/?room=${id}`);
    await expect(page.getByRole("button", { name: "Close chat" })).toBeVisible();
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();

    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(panel(page)).toHaveText("Click on the map to start a chat");

    // Leaflet loaded tiles only for the short map; without invalidateSize() the strip the sheet
    // uncovers stays grey. Sampled bottom-left, clear of the attribution box.
    const grown = await box(page, ".leaflet-container");
    await makeTilesHitTestable(page);
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("leaflet-tile") ?? false,
          { x: 20, y: grown.y + grown.height - 4 },
        ),
      )
      .toBe(true);
  });

  test("the close button is a 44 px touch target", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 180, 250);
    const close = await page.getByRole("button", { name: "Close chat" }).boundingBox();
    expect(close?.width).toBeGreaterThanOrEqual(44);
    expect(close?.height).toBeGreaterThanOrEqual(44);
  });
});
