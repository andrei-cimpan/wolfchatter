import type { Page } from "@playwright/test";
import { box, expect, makeTilesHitTestable, serveBlankTiles, test } from "./support";

const EMPTY_STATE = "Click on the map to start a chat";

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

async function expectNoPageScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow).toEqual({ x: 0, y: 0 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("map fills the window and the empty-state card floats top right", async ({ page }) => {
    await page.goto("/");
    const panel = page.getByRole("complementary", { name: "Chat" });
    await expect(panel).toHaveText(EMPTY_STATE);
    await expect(page.locator(".leaflet-container")).toBeVisible();

    expect(await box(page, ".leaflet-container")).toEqual({ x: 0, y: 0, width: 1280, height: 720 });

    const card = await box(page, "aside");
    expect(card.width).toBe(380);
    expect(card.x + card.width).toBe(1280 - 16);
    expect(card.y).toBe(16);
    await expectNoPageScroll(page);
  });

  test("panel stays above the map's tiles", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
    await makeTilesHitTestable(page);
    const card = await box(page, "aside");
    const panelOnTop = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("aside") != null,
      { x: card.x + card.width / 2, y: card.y + card.height / 2 },
    );
    expect(panelOnTop).toBe(true);
  });
});

test.describe("desktop card height", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("tall content stays inside the card instead of spilling over the map", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.locator("aside").evaluate((aside) => {
      const filler = document.createElement("div");
      filler.style.height = "2000px";
      aside.append(filler);
    });

    const card = await box(page, "aside");
    expect(card.y + card.height).toBe(720 - 16);
    const spillsBelow = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("aside") != null,
      { x: card.x + card.width / 2, y: card.y + card.height + 8 },
    );
    expect(spillsBelow).toBe(false);
  });
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("banner sits at the bottom, below the map, keeping the attribution visible", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("complementary", { name: "Chat" })).toHaveText(EMPTY_STATE);
    await expect(page.locator(".leaflet-container")).toBeVisible();

    const map = await box(page, ".leaflet-container");
    const sheet = await box(page, "aside");
    expect(sheet.width).toBe(375);
    expect(sheet.y + sheet.height).toBe(667);
    expect(map.y + map.height).toBeLessThanOrEqual(sheet.y);
    expect(map.height).toBeGreaterThan(667 / 2);

    await expect(page.locator(".leaflet-control-attribution")).toBeInViewport();
    // Leaflet's own prefix, then " | " and the configured provider's credit.
    await expect(page.locator(".leaflet-control-attribution")).toContainText(/\|\s*\S/);
    await expectNoPageScroll(page);
  });

  // Without viewport-fit=cover, env(safe-area-inset-bottom) is always 0 and the sheet's
  // padding cannot clear the home indicator on notched phones.
  test("viewport extends under the safe areas", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
  });

  test("zoom buttons are at least 44 px touch targets", async ({ page }) => {
    await page.goto("/");
    for (const name of ["Zoom in", "Zoom out"]) {
      const button = await page.getByRole("button", { name }).boundingBox();
      expect(button?.width).toBeGreaterThanOrEqual(44);
      expect(button?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

const MIN_LIST_PX = 80;
const panel = (page: Page) => page.getByRole("complementary", { name: "Chat" });
const messages = (page: Page) => panel(page).getByRole("log", { name: "Messages" });
const submit = (page: Page) => panel(page).getByRole("button", { name: "Submit" });

/** Opens a room with enough messages to overflow any list, so the list's height is what the layout gave it. */
async function openFullRoom(page: Page) {
  const response = await page.request.post("/api/rooms", { data: { lat: 48, lng: 20 } });
  const { id } = (await response.json()) as { id: string };
  for (let i = 1; i <= 8; i++) {
    await page.request.post(`/api/rooms/${id}/messages`, { data: { author: "bo", body: `Message ${i}` } });
  }
  await page.goto(`/?room=${id}`);
  await expect(messages(page).getByRole("listitem")).toHaveCount(8);
}

// The list scrolls in the log's parent.
const listHeight = (page: Page) => messages(page).locator("..").evaluate((el) => el.clientHeight);

async function expectUsableChat(page: Page, viewportHeight: number) {
  expect(await listHeight(page)).toBeGreaterThanOrEqual(MIN_LIST_PX);
  const button = await submit(page).boundingBox();
  expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(viewportHeight);
  await expectNoPageScroll(page);
}

async function expectPostWorks(page: Page) {
  await panel(page).getByRole("textbox", { name: "Username" }).fill("ana");
  await panel(page).getByRole("textbox", { name: "Message" }).fill("Sent from a short screen");
  await submit(page).click();
  await expect(messages(page).getByRole("listitem").last()).toContainText("Sent from a short screen");
  await expect(messages(page).getByRole("listitem").last()).toBeInViewport({ ratio: 0.9 });
}

test.describe("short upright screen", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("the sheet is taller than half the screen, so the list keeps its room", async ({ page }) => {
    await openFullRoom(page);
    const sheet = await box(page, "aside");
    expect(sheet.height).toBe(320);
    expect(sheet.y + sheet.height).toBe(568);
    await expectUsableChat(page, 568);
    await expectPostWorks(page);
  });
});

for (const { width, height } of [
  { width: 667, height: 375 },
  { width: 568, height: 320 },
]) {
  test.describe(`phone on its side, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("the chat sits beside the map, and the map keeps its attribution", async ({ page }) => {
      await openFullRoom(page);
      const sheet = await box(page, "aside");
      expect(sheet).toEqual({ x: width / 2, y: 0, width: width / 2, height });
      await expect(page.getByRole("button", { name: "Close chat" })).toBeVisible();
      await expectUsableChat(page, height);
      await expectPostWorks(page);

      expect(await box(page, ".leaflet-container")).toEqual({ x: 0, y: 0, width: width / 2, height });
      await expect(page.locator(".leaflet-control-attribution")).toBeInViewport();
    });
  });
}

test.describe("phone on its side, 667x375", () => {
  test.use({ viewport: { width: 667, height: 375 } });

  test("with no room open the banner stays below the map", async ({ page }) => {
    await page.goto("/");
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    const sheet = await box(page, "aside");
    expect(sheet.width).toBe(667);
    expect(sheet.y + sheet.height).toBe(375);
    const map = await box(page, ".leaflet-container");
    expect(map.width).toBe(667);
    expect(map.y + map.height).toBeLessThanOrEqual(sheet.y);
  });

  test("a new room's pin is centred in the map left beside the chat", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.locator(".leaflet-container").click({ position: { x: 500, y: 100 } });
    const title = panel(page).getByRole("heading", { level: 2 });
    await expect(title).toHaveText(/^Chatroom \d+$/);

    const pin = page.getByRole("button", { name: (await title.textContent()) ?? "", exact: true });
    await expect(async () => {
      const icon = await pin.boundingBox();
      // The icon's tip is 12 px right of its left edge and 41 px below its top.
      expect(Math.abs((icon?.x ?? 0) + 12 - 667 / 4)).toBeLessThan(3);
      expect(Math.abs((icon?.y ?? 0) + 41 - 375 / 2)).toBeLessThan(3);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("large phone on its side", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("gets the floating card, with the list keeping its room", async ({ page }) => {
    await openFullRoom(page);
    const card = await box(page, "aside");
    expect(card.width).toBe(380);
    expect(card.y).toBe(16);
    await expectUsableChat(page, 390);
    expect(await box(page, ".leaflet-container")).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  });
});

for (const { width, height } of [
  { width: 800, height: 200 },
  { width: 300, height: 260 },
]) {
  test.describe(`very short window, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("the panel scrolls, so Submit stays reachable and the list keeps its room", async ({ page }) => {
      await openFullRoom(page);
      expect(await listHeight(page)).toBeGreaterThanOrEqual(MIN_LIST_PX);
      await expectPostWorks(page);
      await expectNoPageScroll(page);
    });
  });
}
