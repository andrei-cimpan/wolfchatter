import type { Locator, Page } from "@playwright/test";
import { expect, tileZooms } from "./support";

// Locators and actions on the chat page that several specs share.

export const ROOM_URL = /\?room=[0-9a-f-]{36}$/;
export const ROOM_TITLE = /^Chatroom \d+$/;
export const DRAFT_TITLE = "New chatroom";
export const DRAFT_NOTE = "Send the first message to create this chatroom. Until then, nobody else can see it.";
export const EMPTY_STATE = "Click on the map to start a chat";

export async function openMap(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".leaflet-container")).toBeVisible();
}

export const panel = (page: Page) => page.getByRole("complementary", { name: "Chat" });
export const roomTitle = (page: Page) => panel(page).getByRole("heading", { level: 2 });
export const pin = (page: Page, title: string) => page.getByRole("button", { name: title, exact: true });
export const messages = (page: Page) => panel(page).getByRole("log", { name: "Messages" });
export const usernameField = (page: Page) => panel(page).getByRole("textbox", { name: "Username" });

export const draftPin = (page: Page) => page.locator(".leaflet-marker-icon.draft-pin");
export const messageField = (page: Page) => panel(page).getByRole("textbox", { name: "Message" });
export const submit = (page: Page) => panel(page).getByRole("button", { name: "Submit" });
export const discard = (page: Page) => panel(page).getByRole("button", { name: "Discard" });

/** Clicks the map at a point inside it and waits for the draft that opens. */
export async function startDraftAt(page: Page, x: number, y: number) {
  await page.locator(".leaflet-container").click({ position: { x, y } });
  await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
  await expect(draftPin(page)).toBeVisible();
}

export async function fillDraft(page: Page, body = "First message") {
  await usernameField(page).fill("ana");
  await messageField(page).fill(body);
}

/** Clicks the map at a point inside it, sends a first message and returns the new room's title. */
export async function createRoomAt(page: Page, x: number, y: number): Promise<string> {
  await startDraftAt(page, x, y);
  await fillDraft(page);
  await submit(page).click();
  await expect(page).toHaveURL(ROOM_URL);
  await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
  return (await roomTitle(page).textContent()) ?? "";
}

/** Where the selected room's pin ends up on a 1280 px view: centred in the map left of the card. */
export const CARD_FOCUS_X = (1280 - 396) / 2;

export const CARD_SHIFT_PX = 396 / 2;
/** A whole world is 256 * 2^5 px wide at the zoom the map opens at. */
export const ZOOM_5_PX_PER_DEGREE = (256 * 2 ** 5) / 360;

/** Where the next room is created, read from its request. A pin always flies to the same spot on screen, wherever it was dropped. */
export async function postedRoomPosition(page: Page) {
  const request = await page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/rooms",
  );
  return request.postDataJSON() as { lat: number; lng: number };
}

export function expectPosition(actual: { lat: number; lng: number }, expected: { lat: number; lng: number }) {
  expect(Math.abs(actual.lat - expected.lat)).toBeLessThan(0.1);
  expect(Math.abs(actual.lng - expected.lng)).toBeLessThan(0.1);
}

export async function postRoom(page: Page, position: { lat: number; lng: number }) {
  const response = await page.request.post("/api/rooms", { data: position });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; title: string };
}

/** Waits for the flight to end with the pin's tip (12 px in, at the icon's foot) on this point. */
async function expectTipAt(icon: Locator, point: { x: number; y: number }) {
  await expect(async () => {
    const box = await icon.boundingBox();
    expect(Math.abs((box?.x ?? 0) + 12 - point.x)).toBeLessThan(3);
    expect(Math.abs((box?.y ?? 0) + 41 - point.y)).toBeLessThan(3);
  }).toPass({ timeout: 10_000 });
}

export function expectPinTipAt(page: Page, title: string, point: { x: number; y: number }) {
  return expectTipAt(pin(page, title), point);
}

export function expectDraftPinTipAt(page: Page, point: { x: number; y: number }) {
  return expectTipAt(draftPin(page), point);
}

/** At a whole zoom every tile is 256 px wide; a zoom left between levels scales them and blurs the map. */
export async function expectWholeZoom(page: Page) {
  await expect
    .poll(
      () => page.locator(".leaflet-tile").evaluateAll((tiles) => [...new Set(tiles.map((t) => t.getBoundingClientRect().width))]),
      { timeout: 5000 },
    )
    .toEqual([256]);
}

export async function expectZoomKept(page: Page) {
  await expectWholeZoom(page);
  expect(await tileZooms(page)).toEqual(["5"]);
}

/** Next keeps useSearchParams in sync with pushState, which is how the app selects a room. */
export function selectInPage(page: Page, id: string) {
  return page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), id);
}

/** Pausing before the release means no inertia, so the drag's moveend comes right at mouse up. */
export async function dragWithoutInertia(page: Page) {
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
export function trackPinX(page: Page, title?: string): Promise<number[]> {
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

export function countRoomPosts(page: Page) {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/rooms") {
      posts.push(request.url());
    }
  });
  return posts;
}

/** Holds the next room creation until the returned function is called, which then fails it. */
export async function holdRoomPost(page: Page) {
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
