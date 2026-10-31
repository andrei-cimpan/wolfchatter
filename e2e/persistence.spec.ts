import type { Page } from "@playwright/test";
import { expect, serveBlankTiles, test } from "./support";

const ROOM_URL = /\?room=[0-9a-f-]{36}$/;

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

const panel = (page: Page) => page.getByRole("complementary", { name: "Chat" });
const roomTitle = (page: Page) => panel(page).getByRole("heading", { level: 2 });
const messages = (page: Page) => panel(page).getByRole("log", { name: "Messages" });
const usernameField = (page: Page) => panel(page).getByRole("textbox", { name: "Username" });
const pin = (page: Page, title: string) => page.getByRole("button", { name: title, exact: true });

async function openMap(page: Page) {
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
}

/** Creates a room by clicking the map, posts one message in it, and returns the room's title. */
async function createRoomWithMessage(page: Page, x: number, y: number, body: string): Promise<string> {
  const before = page.url();
  await page.locator(".leaflet-container").click({ position: { x, y } });
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(ROOM_URL);
  await expect(messages(page)).toBeAttached();
  await usernameField(page).fill("ana");
  await panel(page).getByRole("textbox", { name: "Message" }).fill(body);
  await panel(page).getByRole("button", { name: "Submit" }).click();
  await expect(messages(page)).toContainText(body);
  return (await roomTitle(page).textContent()) ?? "";
}

// The ownRoomsOnly fixture keeps the rooms this page created across a reload, so the pins drawn
// afterwards come from a fresh viewport request whose answer the fixture replaces. The panel's
// room and messages are the server's own: the reload empties the query cache.
test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("reloading restores the pins, the selected room and every room's messages", async ({ page }) => {
    await openMap(page);
    const first = await createRoomWithMessage(page, 400, 300, "Before the reload, first room");
    const firstUrl = page.url();
    const second = await createRoomWithMessage(page, 600, 450, "Before the reload, second room");
    const secondUrl = page.url();

    await page.reload();
    await expect(page).toHaveURL(secondUrl);
    await expect(roomTitle(page)).toHaveText(second);
    await expect(messages(page).getByRole("listitem")).toHaveText([/ana:[\s\S]*Before the reload, second room/]);
    await expect(pin(page, first)).toBeVisible();
    await expect(pin(page, second)).toBeVisible();
    // Kept only in memory until T5.1 saves it.
    await expect(usernameField(page)).toHaveValue("");

    await pin(page, first).click();
    await expect(page).toHaveURL(firstUrl);
    await expect(roomTitle(page)).toHaveText(first);
    await expect(messages(page).getByRole("listitem")).toHaveText([/Before the reload, first room/]);
  });

  test("Back still walks the rooms opened before a reload", async ({ page }) => {
    await openMap(page);
    const first = await createRoomWithMessage(page, 400, 300, "One");
    await createRoomWithMessage(page, 600, 450, "Two");

    await page.reload();
    await expect(messages(page)).toContainText("Two");
    await page.goBack();
    await expect(roomTitle(page)).toHaveText(first);
    await expect(messages(page)).toContainText("One");
  });
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("reloading keeps the sheet raised on the selected room", async ({ page }) => {
    await openMap(page);
    const title = await createRoomWithMessage(page, 180, 250, "From my phone");

    await page.reload();
    await expect(roomTitle(page)).toHaveText(title);
    await expect(messages(page)).toContainText("From my phone");
    await expect(page.getByRole("button", { name: "Close chat" })).toBeVisible();
    const sheet = await panel(page).boundingBox();
    expect(sheet?.height).toBeCloseTo(667 / 2, 0);
  });
});
