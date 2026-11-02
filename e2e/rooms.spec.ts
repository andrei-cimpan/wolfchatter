import type { Page } from "@playwright/test";
import { box, expect, makeTilesHitTestable, serveBlankTiles, test, tileZooms } from "./support";

const ROOM_URL = /\?room=[0-9a-f-]{36}$/;
const ROOM_TITLE = /^Chatroom \d+$/;
const DRAFT_TITLE = "New chatroom";
const DRAFT_NOTE = "Send the first message to create this chatroom. Until then, nobody else can see it.";
const EMPTY_STATE = "Click on the map to start a chat";

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

const draftPin = (page: Page) => page.locator(".leaflet-marker-icon.draft-pin");
const messageField = (page: Page) => panel(page).getByRole("textbox", { name: "Message" });
const submit = (page: Page) => panel(page).getByRole("button", { name: "Submit" });
const discard = (page: Page) => panel(page).getByRole("button", { name: "Discard" });

/** Clicks the map at a point inside it and waits for the draft that opens. */
async function startDraftAt(page: Page, x: number, y: number) {
  await page.locator(".leaflet-container").click({ position: { x, y } });
  await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
  await expect(draftPin(page)).toBeVisible();
}

async function fillDraft(page: Page, body = "First message") {
  await panel(page).getByRole("textbox", { name: "Username" }).fill("ana");
  await messageField(page).fill(body);
}

/** Clicks the map at a point inside it, sends a first message and returns the new room's title. */
async function createRoomAt(page: Page, x: number, y: number): Promise<string> {
  await startDraftAt(page, x, y);
  await fillDraft(page);
  await submit(page).click();
  await expect(page).toHaveURL(ROOM_URL);
  await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
  return (await roomTitle(page).textContent()) ?? "";
}

/** Where the selected room's pin ends up on a 1280 px view: centred in the map left of the card. */
const CARD_FOCUS_X = (1280 - 396) / 2;

const CARD_SHIFT_PX = 396 / 2;
/** A whole world is 256 * 2^5 px wide at the zoom the map opens at. */
const ZOOM_5_PX_PER_DEGREE = (256 * 2 ** 5) / 360;

/** Where the next room is created, read from its request. A pin always flies to the same spot on screen, wherever it was dropped. */
async function postedRoomPosition(page: Page) {
  const request = await page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/rooms",
  );
  return request.postDataJSON() as { lat: number; lng: number };
}

function expectPosition(actual: { lat: number; lng: number }, expected: { lat: number; lng: number }) {
  expect(Math.abs(actual.lat - expected.lat)).toBeLessThan(0.1);
  expect(Math.abs(actual.lng - expected.lng)).toBeLessThan(0.1);
}

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

async function expectDraftPinTipAt(page: Page, point: { x: number; y: number }) {
  await expect(async () => {
    const icon = await draftPin(page).boundingBox();
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

/** Holds the next room creation until the returned function is called, which then fails it. */
async function holdRoomPost(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/rooms", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await held;
    await route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "boom" } } });
  });
  return release;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("a click drops a draft that saves nothing, and the first message creates the room", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expect(panel(page)).toContainText(DRAFT_NOTE);
    await expect(panel(page)).not.toContainText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveAttribute("title", "New chatroom (not created yet)");
    await expect(page).toHaveURL(/\/$/);
    expect(posts).toHaveLength(0);

    await fillDraft(page, "Hello from a new room");
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
    const title = (await roomTitle(page).textContent()) ?? "";
    await expect(pin(page, title)).toBeVisible();
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).not.toContainText(DRAFT_NOTE);
    await expect(panel(page).getByRole("log", { name: "Messages" })).toContainText("Hello from a new room");
    // The writer can carry on without clicking back in.
    await expect(messageField(page)).toBeFocused();
    await expect(messageField(page)).toHaveValue("");
    expect(posts).toHaveLength(1);
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

  test("a zoom that starts just after a flight does, then a drag, still ends on a whole zoom", async ({ page }) => {
    // Leaflet starts a button's zoom on the next animation frame. Which comes first, that frame or
    // the flight the selection starts, is a race, so this holds the frame back to force the order.
    await page.addInitScript(() => {
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        const { dataset } = document.documentElement;
        if (dataset.holdNextFrame === undefined) return request(callback);
        delete dataset.holdNextFrame;
        return window.setTimeout(() => callback(performance.now()), 200);
      };
    });
    const far = await postRoom(page, { lat: -33.87, lng: 151.2 });
    const near = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page);
    await selectInPage(page, far.id);
    await expectPinTipAt(page, far.title, { x: CARD_FOCUS_X, y: 360 });
    await selectInPage(page, near.id);
    await expectPinTipAt(page, near.title, { x: CARD_FOCUS_X, y: 360 });

    await page.evaluate((room) => {
      document.documentElement.dataset.holdNextFrame = "";
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

  test("double-clicking zooms in and drops no pin", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);

    await page.locator(".leaflet-container").dblclick({ position: { x: 500, y: 400 } });
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await page.waitForTimeout(400);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });

  test("double-clicking keeps a draft dropped earlier where it is", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page);
    await page.locator(".leaflet-container").dblclick({ position: { x: 300, y: 500 } });
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await page.waitForTimeout(400);
    await expect(draftPin(page)).toBeVisible();
    await expect(messageField(page)).toHaveValue("First message");
  });

  test("clicks while the first message is being sent are ignored", async ({ page }) => {
    const posts = countRoomPosts(page);
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page);
    await submit(page).click();
    await expect(panel(page).getByRole("status").filter({ hasText: "Creating a chatroom…" })).toBeVisible();
    await page.mouse.click(300, 500);
    await expect(page).toHaveURL(ROOM_URL);
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(1);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("picking a pin while a first message is being sent keeps that pick, and creating still works", async ({
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
    await startDraftAt(page, 600, 450);
    await fillDraft(page);
    await submit(page).click();
    await expect(panel(page).getByRole("status").filter({ hasText: "Creating a chatroom…" })).toBeVisible();
    await pin(page, first).click();
    await created;
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(firstUrl);
    await expect(roomTitle(page)).toHaveText(first);
    await expect(draftPin(page)).toHaveCount(0);

    slow = false;
    await createRoomAt(page, 800, 550);
    expect(posts).toHaveLength(3);
  });

  test("with only a keyboard, Enter on the map drops a draft in the clear part, and the form can be reached", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await page.locator(".leaflet-container").focus();
    await page.keyboard.press("Enter");
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    expect(posts).toHaveLength(0);

    const username = panel(page).getByRole("textbox", { name: "Username" });
    await expect(async () => {
      await page.keyboard.press("Tab");
      await expect(username).toBeFocused({ timeout: 100 });
    }).toPass({ timeout: 10_000, intervals: [0] });
    await page.keyboard.type("ana");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Typed, never clicked");
    await page.keyboard.press("Tab");
    const posted = postedRoomPosition(page);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(ROOM_URL);
    expect(posts).toHaveLength(1);
    // The map opens centred on 48, 20; the clear part's centre is CARD_SHIFT_PX west of that.
    expectPosition(await posted, { lat: 48, lng: 20 - CARD_SHIFT_PX / ZOOM_5_PX_PER_DEGREE });
  });

  test("Enter drops the draft where the arrow keys moved the map", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").focus();
    await page.keyboard.press("Enter");
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    const before = await draftPin(page).boundingBox();

    await page.keyboard.press("ArrowLeft");
    let panned = 0;
    await expect(async () => {
      const moved = await draftPin(page).boundingBox();
      panned = (moved?.x ?? 0) - (before?.x ?? 0);
      expect(panned).toBeGreaterThanOrEqual(80);
    }).toPass();

    await page.keyboard.press("Enter");
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    await fillDraft(page);
    const posted = postedRoomPosition(page);
    await submit(page).click();
    expectPosition(await posted, { lat: 48, lng: 20 - (CARD_SHIFT_PX + panned) / ZOOM_5_PX_PER_DEGREE });
  });

  test("after dragging the map, Enter keeps an open room and its unsent reply", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await messageField(page).fill("Half written");
    await dragWithoutInertia(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    await expect(roomTitle(page)).toHaveText(room.title);
    await expect(messageField(page)).toHaveValue("Half written");
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("after dragging the map, Enter leaves a draft where it is", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    await fillDraft(page, "Half written");
    await dragWithoutInertia(page);
    const before = await draftPin(page).boundingBox();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect(await draftPin(page).boundingBox()).toEqual(before);
    await expect(messageField(page)).toHaveValue("Half written");
  });

  test("Enter works again once the keyboard brings the focus back to a dragged map", async ({ page }) => {
    await openMap(page);
    await dragWithoutInertia(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".leaflet-container")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
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

  test("a creation error goes away with its draft", async ({ page }) => {
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } })
        : route.fallback(),
    );
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page);
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toHaveText("Couldn't create the chatroom. Please try again.");

    await discard(page).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await startDraftAt(page, 600, 450);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  });

  test("a slow double-click zooms and takes back the pin its first click dropped", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    await page.mouse.click(500, 150);
    await expect(draftPin(page)).toBeVisible();
    // The second click of the same double-click (detail 2), landing wherever the flight has got to.
    // Up here it is on the map, whichever way the flight moved the pin.
    await page.mouse.move(500, 40);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await expectWholeZoom(page);
    expect(posts).toHaveLength(0);
  });

  test("a rate-limited first message explains the wait, keeps the text and creates nothing", async ({ page }) => {
    let limited = true;
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST" && limited
        ? route.fulfill({
            status: 429,
            headers: { "Retry-After": "30" },
            json: { error: { code: "rate_limited", message: "Too many requests" } },
          })
        : route.fallback(),
    );
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Worth keeping");
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toHaveText(
      "You're creating chatrooms too quickly. Try again in 30 seconds.",
    );
    await expect(page).toHaveURL(/\/$/);
    await expect(draftPin(page)).toBeVisible();
    await expect(messageField(page)).toHaveValue("Worth keeping");

    limited = false;
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(panel(page).getByRole("log", { name: "Messages" })).toContainText("Worth keeping");
  });

  test("clicking elsewhere moves the draft and keeps what was typed", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Still here");
    await page.locator(".leaflet-container").click({ position: { x: 200, y: 600 } });
    await expect(async () => {
      const after = await draftPin(page).boundingBox();
      expect(Math.abs((after?.x ?? 0) + 12 - CARD_FOCUS_X)).toBeLessThan(3);
      expect(Math.abs((after?.y ?? 0) + 41 - 360)).toBeLessThan(3);
    }).toPass({ timeout: 10_000 });
    await expect(draftPin(page)).toHaveCount(1);
    await expect(messageField(page)).toHaveValue("Still here");
    expect(posts).toHaveLength(0);
  });

  test("the draft's pin is centred clear of the card, as a room's is", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 100, 600);
    await expect(async () => {
      const icon = await draftPin(page).boundingBox();
      expect(Math.abs((icon?.x ?? 0) + 12 - CARD_FOCUS_X)).toBeLessThan(3);
      expect(Math.abs((icon?.y ?? 0) + 41 - 360)).toBeLessThan(3);
    }).toPass({ timeout: 10_000 });
  });

  test("Discard removes the draft and saves nothing", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Never mind");
    await discard(page).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);

    await startDraftAt(page, 600, 450);
    await expect(messageField(page)).toHaveValue("");
  });

  test("opening a room discards the draft", async ({ page }) => {
    await openMap(page);
    const title = await createRoomAt(page, 400, 300);
    await startDraftAt(page, 200, 150);
    await pin(page, title).click();
    await expect(roomTitle(page)).toHaveText(title);
    await expect(draftPin(page)).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  test("Back from a draft over an open room returns to the room and ends the draft", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Half written");
    await expect(page).toHaveURL(/\/$/);

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    await expect(draftPin(page)).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a first message that fails after Back leaves no error for Forward to show", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Sent, then left");
    const failPost = await holdRoomPost(page);
    await submit(page).click();
    await expect(panel(page)).toContainText("Creating a chatroom…");

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    failPost();
    await expect(panel(page)).not.toContainText("Creating a chatroom…");

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a first message that fails after Back and Forward leaves no error either", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Sent, then left");
    const failPost = await holdRoomPost(page);
    await submit(page).click();
    await expect(panel(page)).toContainText("Creating a chatroom…");

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    failPost();

    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a draft ended by Back does not come back on an older entry", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Half written");

    await page.goBack();
    await expect(page).toHaveURL(ROOM_URL);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("saving a draft from the empty map leaves Back on the empty map", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("clicking the draft's pin leaves the draft where it was", async ({ page }) => {
    const savedLat = async () => {
      await fillDraft(page);
      const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/rooms");
      await submit(page).click();
      return ((await request).postDataJSON() as { lat: number }).lat;
    };
    await openMap(page);
    await startDraftAt(page, 400, 300);
    const untouched = await savedLat();

    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    // Its head, well above the tip: a click passing through to the map would move the draft here.
    await page.mouse.click(CARD_FOCUS_X, 360 - 33);
    await page.waitForTimeout(800);
    expect(await savedLat()).toBeCloseTo(untouched, 5);
  });

  /** A real double-click can be slower than the wait on an empty map, here 320 ms between clicks. */
  async function slowDoubleClick(page: Page, x: number, y: number) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(320);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
  }

  test("a slow double-click keeps a draft dropped earlier, with its text", async ({ page }) => {
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Half written");
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });

    await slowDoubleClick(page, 800, 150);
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await page.waitForTimeout(600);
    await expect(draftPin(page)).toHaveCount(1);
    await expect(messageField(page)).toHaveValue("Half written");
  });

  test("a slow double-click keeps an open room and an unsent reply", async ({ page }) => {
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    const title = await createRoomAt(page, 400, 300);
    const roomUrl = page.url();
    await messageField(page).fill("Half written reply");
    await expectPinTipAt(page, title, { x: CARD_FOCUS_X, y: 360 });

    await slowDoubleClick(page, 800, 150);
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(roomUrl);
    await expect(roomTitle(page)).toHaveText(title);
    await expect(messageField(page)).toHaveValue("Half written reply");
  });

  test("a pin picked straight after a click on the map keeps that pick", async ({ page }) => {
    await openMap(page);
    const first = await createRoomAt(page, 400, 300);
    const firstUrl = page.url();
    await createRoomAt(page, 600, 450);
    await page.waitForTimeout(1500);
    const target = await pin(page, first).boundingBox();

    await page.mouse.click(200, 650);
    await page.mouse.click((target?.x ?? 0) + 12, (target?.y ?? 0) + 20);
    await expect(page).toHaveURL(firstUrl);
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(firstUrl);
    await expect(roomTitle(page)).toHaveText(first);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("Back straight after a click on the map drops no pin", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await page.mouse.click(200, 650);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(800);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  test("moving the map straight after a click on it drops no pin", async ({ page }) => {
    await openMap(page);
    await page.mouse.click(500, 400);
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(550, 430, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await expect(draftPin(page)).toHaveCount(0);

    await page.mouse.click(500, 400);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(600);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  test("a double-tap reporting two single clicks still only zooms", async ({ page }) => {
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    // Some touch platforms send no native dblclick and always report detail 1; Leaflet simulates
    // the dblclick for them. Dispatched here because a real browser's clicks count properly.
    await page.evaluate(() => {
      const target = document.elementFromPoint(500, 400);
      const at = { bubbles: true, cancelable: true, clientX: 500, clientY: 400, view: window, detail: 1 };
      target?.dispatchEvent(new MouseEvent("click", at));
      target?.dispatchEvent(new MouseEvent("click", at));
      target?.dispatchEvent(new MouseEvent("dblclick", { ...at, detail: 2 }));
    });
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await page.waitForTimeout(600);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  test("a slow double-click whose second click lands on the new pin zooms and takes the pin back", async ({ page }) => {
    // Without a flight the pin stays where the second click lands.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    await page.mouse.click(500, 150);
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    await page.mouse.move(CARD_FOCUS_X, 360 - 33);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  test("a slow double-tap whose second tap lands on the new pin takes the pin back", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    await page.mouse.click(500, 150);
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    // Some touch platforms always report detail 1, and Leaflet simulates the dblclick for them.
    await page.evaluate(
      ({ clientX, clientY }) => {
        const at = { bubbles: true, cancelable: true, clientX, clientY, view: window, detail: 1 };
        const pin = document.elementFromPoint(clientX, clientY);
        pin?.dispatchEvent(new MouseEvent("click", at));
        pin?.dispatchEvent(new MouseEvent("dblclick", { ...at, detail: 2 }));
      },
      { clientX: CARD_FOCUS_X, clientY: 360 - 33 },
    );
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("double-clicking a draft's pin later zooms and keeps the draft, with its text", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    await startDraftAt(page, 500, 150);
    await fillDraft(page, "Half written");
    await expectDraftPinTipAt(page, { x: CARD_FOCUS_X, y: 360 });
    await page.mouse.dblclick(CARD_FOCUS_X, 360 - 33);
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await expect(draftPin(page)).toHaveCount(1);
    await expect(messageField(page)).toHaveValue("Half written");
  });

  test("a slow double-tap reporting two single clicks takes back its pin", async ({ page }) => {
    await openMap(page);
    await expect.poll(() => tileZooms(page)).toEqual(["5"]);
    const dispatch = (type: string, y: number) =>
      page.evaluate(
        ({ eventType, clientY }) => {
          const at = { bubbles: true, cancelable: true, clientX: 500, clientY, view: window, detail: 1 };
          document.elementFromPoint(500, clientY)?.dispatchEvent(new MouseEvent(eventType, at));
        },
        { eventType: type, clientY: y },
      );
    await dispatch("click", 150);
    await expect(draftPin(page)).toBeVisible();
    // Up here it is on the map, whichever way the flight moved the pin.
    await dispatch("click", 40);
    await dispatch("dblclick", 40);
    await expect.poll(() => tileZooms(page)).toEqual(["6"]);
    await page.waitForTimeout(600);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("Discard shows as unavailable while the first message is on its way", async ({ page }) => {
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expect(discard(page)).not.toHaveAttribute("aria-disabled", "true");
    await fillDraft(page);
    await submit(page).click();
    await expect(discard(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page).toHaveURL(ROOM_URL);
  });

  test("a new room's message field takes the focus only once", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await expect(messageField(page)).toBeFocused();
    await page.goBack();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await page.goForward();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(messageField(page)).toBeVisible();
    // On a phone this would pop up the keyboard for someone who only went back to look.
    await expect(messageField(page)).not.toBeFocused();
  });

  test("Discard leaves the focus on the map, and the note is announced", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expect(panel(page).getByRole("status").filter({ hasText: DRAFT_NOTE })).toBeVisible();
    await discard(page).click();
    await expect(page.locator(".leaflet-container")).toBeFocused();
  });

  test("a draft moved after closing a room still returns Back to that room once saved", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await page.locator(".leaflet-container").click({ position: { x: 700, y: 150 } });
    await page.waitForTimeout(700);
    await expect(draftPin(page)).toHaveCount(1);
    await fillDraft(page);
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(roomTitle(page)).toHaveText(ROOM_TITLE);

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
  });

  test("moving a draft clears a failed send's error and keeps the text", async ({ page }) => {
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } })
        : route.fallback(),
    );
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Try again");
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toBeVisible();

    await page.locator(".leaflet-container").click({ position: { x: 700, y: 150 } });
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    await expect(messageField(page)).toHaveValue("Try again");
  });

  test("reloading loses a draft", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await page.reload();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
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

  test("a draft raises the sheet with the note and form on screen; the header's Discard lowers it", async ({
    page,
  }) => {
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 180, y: 250 } });
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await expect(panel(page)).toContainText(DRAFT_NOTE);
    const sheet = await box(page, "aside");
    expect(sheet.y + sheet.height).toBe(667);
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
    const button = await discard(page).boundingBox();
    expect(button?.height).toBeGreaterThanOrEqual(44);

    await discard(page).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("saving a draft never lowers the sheet, even for a frame", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 180, y: 250 } });
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await fillDraft(page);
    await page.evaluate(() => {
      const heights: number[] = [];
      Object.assign(window, { sheetHeights: heights });
      const sample = () => {
        heights.push(document.querySelector("aside")?.getBoundingClientRect().height ?? 0);
        requestAnimationFrame(sample);
      };
      sample();
    });
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
    await page.waitForTimeout(200);

    const heights = await page.evaluate(() => (window as unknown as { sheetHeights: number[] }).sheetHeights);
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeCloseTo(667 / 2, 0);
  });

  test("the close button shows as unavailable while a first message is on its way", async ({ page }) => {
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await startDraftAt(page, 180, 250);
    await fillDraft(page);
    const close = page.getByRole("button", { name: "Close chat" });
    await expect(close).not.toHaveAttribute("aria-disabled", "true");
    await submit(page).click();
    await expect(close).toHaveAttribute("aria-disabled", "true");
    await expect(page).toHaveURL(ROOM_URL);
    await expect(close).not.toHaveAttribute("aria-disabled", "true");
  });

  test("the close button also discards a draft", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 180, y: 250 } });
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("Enter on the map drops the draft at the map's centre, with no card to clear", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").focus();
    await page.keyboard.press("Enter");
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await fillDraft(page);
    const posted = postedRoomPosition(page);
    await submit(page).click();
    expectPosition(await posted, { lat: 48, lng: 20 });
  });

  test("the close button is a 44 px touch target", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 180, 250);
    const close = await page.getByRole("button", { name: "Close chat" }).boundingBox();
    expect(close?.width).toBeGreaterThanOrEqual(44);
    expect(close?.height).toBeGreaterThanOrEqual(44);
  });
});
