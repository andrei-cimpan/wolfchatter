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

type CreatedRoom = { id: string; title: string; lat: number; lng: number };

/** Creates a room by clicking the map, posts one message in it, and returns the room. */
async function createRoomWithMessage(page: Page, x: number, y: number, body: string): Promise<CreatedRoom> {
  const before = page.url();
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/rooms",
  );
  await page.locator(".leaflet-container").click({ position: { x, y } });
  const room = (await (await created).json()) as CreatedRoom;
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(ROOM_URL);
  await expect(messages(page)).toBeAttached();
  await usernameField(page).fill("ana");
  await panel(page).getByRole("textbox", { name: "Message" }).fill(body);
  await panel(page).getByRole("button", { name: "Submit" }).click();
  await expect(messages(page)).toContainText(body);
  return room;
}

/**
 * Asks the server itself for the room's surroundings, at zoom 16 where nothing is clustered.
 * page.request skips the page's routes, so the ownRoomsOnly fixture cannot answer for it.
 */
async function expectServerListsRoom(page: Page, room: CreatedRoom) {
  const d = 0.001;
  const bbox = [room.lng - d, room.lat - d, room.lng + d, room.lat + d].join(",");
  const response = await page.request.get(`/api/rooms?bbox=${bbox}&zoom=16`);
  expect(response.ok()).toBe(true);
  const ids = ((await response.json()) as { id?: string }[]).map((item) => item.id);
  expect(ids).toContain(room.id);
}

// The ownRoomsOnly fixture keeps the rooms this page created across a reload and answers the
// fresh viewport request with them, so the pins drawn afterwards only show that the client asks
// again and draws the answer; expectServerListsRoom checks the server still has them. The panel's
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
    await expect(roomTitle(page)).toHaveText(second.title);
    // Checked once the panel has rendered, so an app that dropped `?room` on load would fail here.
    await expect(page).toHaveURL(secondUrl);
    await expect(messages(page).getByRole("listitem")).toHaveText([/ana:[\s\S]*Before the reload, second room/]);
    await expect(pin(page, first.title)).toBeVisible();
    await expect(pin(page, second.title)).toBeVisible();
    await expectServerListsRoom(page, first);
    await expectServerListsRoom(page, second);
    // Kept only in memory until T5.1 saves it.
    await expect(usernameField(page)).toHaveValue("");

    await pin(page, first.title).click();
    await expect(page).toHaveURL(firstUrl);
    await expect(roomTitle(page)).toHaveText(first.title);
    await expect(messages(page).getByRole("listitem")).toHaveText([/Before the reload, first room/]);
  });

  test("Back still walks the rooms opened before a reload", async ({ page }) => {
    await openMap(page);
    const first = await createRoomWithMessage(page, 400, 300, "One");
    await createRoomWithMessage(page, 600, 450, "Two");

    await page.reload();
    await expect(messages(page)).toContainText("Two");
    await page.goBack();
    await expect(roomTitle(page)).toHaveText(first.title);
    await expect(messages(page)).toContainText("One");
  });
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("reloading keeps the sheet raised on the selected room", async ({ page }) => {
    await openMap(page);
    const room = await createRoomWithMessage(page, 180, 250, "From my phone");

    await page.reload();
    await expect(roomTitle(page)).toHaveText(room.title);
    await expect(messages(page)).toContainText("From my phone");
    await expect(page.getByRole("button", { name: "Close chat" })).toBeVisible();
    const sheet = await panel(page).boundingBox();
    expect(sheet?.height).toBeCloseTo(667 / 2, 0);
  });
});
