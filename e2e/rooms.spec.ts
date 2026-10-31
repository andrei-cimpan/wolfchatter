import type { Page } from "@playwright/test";
import { box, expect, makeTilesHitTestable, serveBlankTiles, test } from "./support";

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

  test("double-clicking creates one room, not two", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await page.locator(".leaflet-container").dblclick({ position: { x: 500, y: 400 } });
    await expect(page).toHaveURL(ROOM_URL);
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(1);
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
    await expect(panel(page).getByRole("status")).toHaveText("Creating a chatroom…");
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
