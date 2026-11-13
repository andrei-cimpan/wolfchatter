import type { Browser, Page } from "@playwright/test";
import { ROOM_URL, messageField, messages, openMap, panel, roomTitle, startDraftAt, submit } from "./chat-page";
import { expect, serveBlankTiles, signInAs, test, watchLiveConnection } from "./support";

const CLOSED_NOTE = "The owner has closed the room";

const deleteRoom = (page: Page) => panel(page).getByRole("button", { name: "Delete room" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Delete this room and all its messages?" });

test.use({ viewport: { width: 1280, height: 720 } });

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

async function createRoomInPanel(page: Page, at = { x: 500, y: 300 }): Promise<string> {
  await openMap(page);
  await startDraftAt(page, at.x, at.y);
  await messageField(page).fill("A room to delete");
  await submit(page).click();
  await expect(page).toHaveURL(ROOM_URL);
  return new URL(page.url()).searchParams.get("room") ?? "";
}

/** A room made by a user other than the page's, and a way to delete it as that user. */
async function roomByCreator(browser: Browser, baseURL: string) {
  const creator = await browser.newContext({ baseURL });
  await signInAs(creator, baseURL, "Ion Ionescu");
  const created = await creator.request.post("/api/rooms", {
    data: { lat: 48, lng: 20, firstMessage: { body: "Soon gone" } },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return {
    id,
    remove: async () => expect((await creator.request.delete(`/api/rooms/${id}`)).status()).toBe(204),
    close: () => creator.close(),
  };
}

test("the creator deletes their room after confirming, and it is gone", async ({ page }) => {
  const id = await createRoomInPanel(page);

  await deleteRoom(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog(page).getByRole("button", { name: "Delete", exact: true }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(panel(page)).toHaveText(/Click on the map to start a chat/);
  await expect(page).not.toHaveURL(/room=/);
  expect((await page.request.get(`/api/rooms/${id}`)).status()).toBe(404);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the button sits in the sheet's header, beside Close, and deletes after confirming", async ({ page }) => {
    await createRoomInPanel(page, { x: 200, y: 150 });
    const header = await panel(page).getByRole("button", { name: "Close chat" }).boundingBox();
    const button = await deleteRoom(page).boundingBox();
    expect(Math.abs((button?.y ?? 0) - (header?.y ?? 0))).toBeLessThan(2);

    await deleteRoom(page).click();
    await dialog(page).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).not.toHaveURL(/room=/);
  });
});

test("Cancel, Escape and a click outside each keep the room", async ({ page }) => {
  const id = await createRoomInPanel(page);

  await deleteRoom(page).click();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await deleteRoom(page).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  await deleteRoom(page).click();
  await page.mouse.click(10, 10);
  await expect(dialog(page)).toHaveCount(0);

  await expect(messages(page)).toContainText("A room to delete");
  expect((await page.request.get(`/api/rooms/${id}`)).status()).toBe(200);
});

test("a failed delete keeps the dialog open and says so", async ({ page }) => {
  await createRoomInPanel(page);
  await page.route("**/api/rooms/*", (route) =>
    route.request().method() === "DELETE" ? route.fulfill({ status: 500, body: "" }) : route.fallback(),
  );

  await deleteRoom(page).click();
  await dialog(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("Couldn't delete the room. Please try again.");
  await expect(roomTitle(page)).toHaveText(/^Chatroom \d+$/);
});

// PR #35 review #5: whether the button shows depends on who is signed in, which can change in place.
test("signing out takes the button away", async ({ page }) => {
  await createRoomInPanel(page);
  await expect(deleteRoom(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Sign out" }).click();
  await expect(panel(page).getByRole("button", { name: "Sign in with Google to post" })).toBeVisible();
  await expect(deleteRoom(page)).toHaveCount(0);
});

test("nobody but the creator is offered the button", async ({ page, browser, baseURL }) => {
  const room = await roomByCreator(browser, baseURL ?? "");
  try {
    await page.goto(`/?room=${room.id}`);
    await expect(messages(page)).toContainText("Soon gone");
    await expect(deleteRoom(page)).toHaveCount(0);
  } finally {
    await room.close();
  }
});

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("a reader with the room open is told live that the owner closed it", async ({ page, browser, baseURL }) => {
    const room = await roomByCreator(browser, baseURL ?? "");
    try {
      const live = await watchLiveConnection(page);
      await page.goto(`/?room=${room.id}`);
      await expect(deleteRoom(page)).toHaveCount(0);
      await live.ready(room.id);

      await room.remove();
      await expect(panel(page).getByRole("status")).toHaveText(CLOSED_NOTE);
      await expect(messages(page)).toHaveCount(0);
      await expect(panel(page).getByRole("button", { name: /Sign in/ })).toHaveCount(0);

      await panel(page).getByRole("button", { name: "Close" }).click();
      await expect(page).not.toHaveURL(/room=/);
    } finally {
      await room.close();
    }
  });

  // PR #35 review #2: the cached room never goes stale, so one deleted while closed must still be
  // found out when it is opened again.
  test("a room deleted while the reader was elsewhere shows as closed on Back", async ({ page, browser, baseURL }) => {
    const room = await roomByCreator(browser, baseURL ?? "");
    try {
      const live = await watchLiveConnection(page);
      await page.goto(`/?room=${room.id}`);
      await live.ready(room.id);
      await page.evaluate(() => window.history.pushState(null, "", "/"));
      await expect(panel(page)).toHaveText(/Click on the map to start a chat/);
      await expect.poll(() => live.liveChannels(room.id)).toBe(0);

      await room.remove();
      // Realtime reads changes a moment late, so a channel opened right away could still be sent
      // this deletion; the reader comes back after it has passed.
      await page.waitForTimeout(1000);
      await page.goBack();
      await expect(panel(page).getByRole("status")).toHaveText(CLOSED_NOTE);
    } finally {
      await room.close();
    }
  });
});
