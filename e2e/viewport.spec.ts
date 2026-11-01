import type { Page } from "@playwright/test";
import { expect, serveBlankTiles, test, tileZooms } from "./support";

// About the real viewport requests, so the map sees every room in the e2e database. Other tests'
// rooms may share the view, so assertions never depend on an area being empty.
test.use({ ownRoomsOnly: false, viewport: { width: 1280, height: 720 } });

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

type MapItem =
  | { type: "room"; id: string; title: string; lat: number; lng: number; messageCount: number }
  | { type: "cluster"; lat: number; lng: number; count: number };

const isViewportRequest = (url: URL) => url.pathname === "/api/rooms";

function countViewportRequests(page: Page) {
  const urls: URLSearchParams[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && isViewportRequest(url)) urls.push(url.searchParams);
  });
  return urls;
}

async function openMap(page: Page) {
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
}

test("the map draws every room and cluster the viewport returns, including rooms made elsewhere", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/rooms", { data: { lat: 55, lng: 1 } });
  expect(created.status()).toBe(201);
  const room = (await created.json()) as { id: string; lat: number; lng: number };

  const response = page.waitForResponse(
    (r) => r.request().method() === "GET" && isViewportRequest(new URL(r.url())),
  );
  await openMap(page);
  const items = (await (await response).json()) as MapItem[];

  // Shown as itself, or folded into a cluster nearby (the zoom-5 cells are 2.8125° wide).
  const near = (item: MapItem) => Math.abs(item.lat - room.lat) < 3 && Math.abs(item.lng - room.lng) < 3;
  expect(items.some((item) => (item.type === "room" ? item.id === room.id : near(item)))).toBe(true);
  // Pins and count bubbles are both Leaflet marker icons; no room is selected to add one more.
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(items.length);
});

test("a cluster shows its count, and clicking it zooms into its cell", async ({ page }) => {
  // A fixed answer, so the bubble does not depend on what other tests left nearby. Rooms are
  // clustered by the server, which the repository tests cover.
  const rooms: MapItem[] = [
    { type: "room", id: "00000000-0000-4000-8000-000000000001", title: "Room A", lat: 39.8, lng: -5.2, messageCount: 0 },
    { type: "room", id: "00000000-0000-4000-8000-000000000002", title: "Room B", lat: 40.7, lng: -4.2, messageCount: 0 },
    { type: "room", id: "00000000-0000-4000-8000-000000000003", title: "Room C", lat: 41.7, lng: -3.2, messageCount: 0 },
  ];
  await page.route(isViewportRequest, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const zoom = new URL(route.request().url()).searchParams.get("zoom");
    return route.fulfill({
      json: zoom === "5" ? [{ type: "cluster", lat: 40.7, lng: -4.2, count: 3 }] : rooms,
    });
  });
  const requests = countViewportRequests(page);
  await openMap(page);

  const bubble = page.getByRole("button", { name: "3 chatrooms", exact: true });
  await expect(bubble).toHaveText("3");
  await bubble.click();

  // The cluster's zoom-5 cell (39.375°N to 42.1875°N, 5.625°W to 2.8125°W) fits the view at zoom 8.
  await expect.poll(() => tileZooms(page)).toEqual(["8"]);
  await expect.poll(() => requests.at(-1)?.get("zoom")).toBe("8");
  for (const { title } of rooms as { title: string }[]) {
    await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  }
  await expect(bubble).toHaveCount(0);
  // Zooming into a cluster is not a click on the map, so it creates no room.
  await expect(page).not.toHaveURL(/\?room=/);
});

async function serveOneCluster(page: Page) {
  await page.route(isViewportRequest, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [{ type: "cluster", lat: 40.7, lng: -4.2, count: 12 }] })
      : route.fallback(),
  );
}

test("a focused cluster zooms in with Enter, and focus moves to the map", async ({ page }) => {
  await serveOneCluster(page);
  await openMap(page);
  await page.getByRole("button", { name: "12 chatrooms", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => tileZooms(page)).toEqual(["8"]);
  // The bubble is gone after the zoom; without this, focus would fall back to the page's start.
  await expect(page.locator(".leaflet-container")).toBeFocused();
});

test("a focused cluster keeps a visible focus ring in forced-colours mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await serveOneCluster(page);
  await openMap(page);
  const bubble = page.getByRole("button", { name: "12 chatrooms", exact: true });
  // Focused from the keyboard, so :focus-visible applies.
  await bubble.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(bubble).toBeFocused();
  // Forced colours drop box-shadow, so the ring must be an outline.
  expect(await bubble.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
});

test("when a viewport fails to load, the pins already shown stay", async ({ page }) => {
  await page.route(isViewportRequest, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const zoom = new URL(route.request().url()).searchParams.get("zoom");
    return zoom === "5"
      ? route.fulfill({ json: [{ type: "cluster", lat: 48, lng: 20, count: 7 }] })
      : route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } });
  });
  const failed = page.waitForResponse((r) => isViewportRequest(new URL(r.url())) && r.status() === 500);
  await openMap(page);
  const bubble = page.getByRole("button", { name: "7 chatrooms", exact: true });
  await expect(bubble).toBeVisible();

  await page.getByRole("button", { name: "Zoom in" }).click();
  await failed;
  // Past the one retry (about a second), when the query settles as an error.
  await page.waitForTimeout(2500);
  await expect(bubble).toHaveCount(1);
});

test("flying to a far room makes one viewport request, once the map arrives", async ({ page, request }) => {
  const created = await request.post("/api/rooms", { data: { lat: -33.87, lng: 151.2 } });
  const { id } = (await created.json()) as { id: string };
  const requests = countViewportRequests(page);
  await openMap(page);
  await expect.poll(() => requests.length).toBe(1);

  await page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), id);
  await expect.poll(() => requests.length, { timeout: 10_000 }).toBe(2);
  await page.waitForTimeout(600);
  expect(requests).toHaveLength(2);
  const [west, , east] = (requests[1]?.get("bbox") ?? "").split(",").map(Number);
  expect(west).toBeLessThan(151.2);
  expect(east).toBeGreaterThan(151.2);
});

test("a small pan reuses the loaded pins instead of asking again", async ({ page }) => {
  const requests = countViewportRequests(page);
  await openMap(page);
  await expect.poll(() => requests.length).toBe(1);
  await page.waitForTimeout(500);

  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(560, 430, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  expect(requests).toHaveLength(1);
});

test("quick successive zooms make one request, once the map settles", async ({ page }) => {
  const requests = countViewportRequests(page);
  await openMap(page);
  await expect.poll(() => requests.length).toBe(1);

  // Each wheel notch zooms one level and ends with a moveend, all within the 250 ms debounce.
  await page.mouse.move(640, 360);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  const finalZoom = (await tileZooms(page)).at(-1);
  expect(Number(finalZoom)).toBeGreaterThan(6);
  expect(requests.map((r) => r.get("zoom"))).toEqual(["5", finalZoom]);
});

test("a zoom loads the new viewport once the map settles", async ({ page }) => {
  const requests = countViewportRequests(page);
  await openMap(page);
  await expect.poll(() => requests.length).toBe(1);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]?.get("zoom")).toBe("6");
});
