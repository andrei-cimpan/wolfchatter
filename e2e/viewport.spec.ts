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

// Mercator stretches a cell near the poles until it fits no higher zoom, and on a short map not even
// its own: at lat 83 with the sheet raised, fitting it alone zoomed out.
for (const { place, viewport, south, firstWest } of [
  { place: "at lat 80", viewport: { width: 1280, height: 720 }, south: 78.75, firstWest: -146.25 },
  {
    place: "at lat 83 on a phone with the sheet raised",
    viewport: { width: 375, height: 667 },
    south: 81.5625,
    firstWest: -90,
  },
]) {
  test(`clicking a cluster ${place} zooms in`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    // Each attempt gets its own zoom-5 cell, and the two places are too far apart to share a view.
    const attempt = testInfo.repeatEachIndex * 2 + testInfo.retry;
    const cell = 360 / 2 ** 5 / 4;
    const west = firstWest + 40 * cell * attempt;
    const post = async (lat: number, lng: number) => {
      const created = await request.post("/api/rooms", { data: { lat, lng } });
      expect(created.status()).toBe(201);
      return (await created.json()) as { id: string };
    };
    for (const part of [0.25, 0.5, 0.75]) await post(south + cell * part, west + cell * part);
    const opened = await post(south + cell / 2, west + cell * 1.5);

    const requests = countViewportRequests(page);
    await page.goto(`/?room=${opened.id}`);
    const bubble = page.getByRole("button", { name: "3 chatrooms", exact: true });
    await expect(bubble).toBeInViewport();
    await expect.poll(() => requests.at(-1)?.get("zoom")).toBe("5");
    await bubble.click();

    await expect.poll(() => requests.at(-1)?.get("zoom")).toBe("6");
    await expect(bubble).toHaveCount(0);
  });
}

test("rooms close together cluster when zoomed out, through the real API, and a click expands them", async ({
  page,
  request,
}, testInfo) => {
  // Each attempt (a retry, or a copy under --repeat-each) gets its own zoom-5 cell in the mid-Pacific,
  // where no other test puts rooms, and its own count, which makes its bubble the only one of that name.
  const attempt = testInfo.repeatEachIndex * 2 + testInfo.retry;
  const count = 3 + attempt;
  const cell = 360 / 2 ** 5 / 4;
  const west = -157.5 + 2 * cell * (attempt % 8);
  // Towards the equator: Mercator stretches cells further south, and one past 50°S no longer fits at zoom 8.
  const south = -39.375 + 2 * cell * Math.floor(attempt / 8);
  const post = async (lat: number, lng: number) => {
    const created = await request.post("/api/rooms", { data: { lat, lng } });
    expect(created.status()).toBe(201);
    return (await created.json()) as { id: string; title: string };
  };
  // Opening this room brings the map here. It is in the next cell, so it is not in the bubble.
  const opened = await post(south + cell / 2, west + cell * 1.5);
  // Eight zoom-8 cells fit across each zoom-5 cell, and each room is in the middle of its own.
  const rooms = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      post(south + (cell / 8) * (Math.floor(i / 8) + 0.5), west + (cell / 8) * (i % 8 + 0.5)),
    ),
  );

  // A page opened on a room shows the default view until the room loads, and a bubble there can have
  // the same name, so the search starts once the map has reached the room and that bubble is off-screen.
  const arrived = page.waitForResponse((response) => {
    const url = new URL(response.url());
    if (response.request().method() !== "GET" || !isViewportRequest(url)) return false;
    const [boxWest, , boxEast] = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
    return (boxWest ?? 0) < west && west < (boxEast ?? 0);
  });
  await page.goto(`/?room=${opened.id}`);
  await arrived;
  const bubble = page.getByRole("button", { name: `${count} chatrooms`, exact: true });
  await expect(bubble).toBeInViewport();
  await expect(bubble).toHaveText(String(count));
  for (const { title } of rooms) await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);

  await bubble.click();
  await expect.poll(() => tileZooms(page)).toEqual(["8"]);
  for (const { title } of rooms) await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await expect(bubble).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`\\?room=${opened.id}$`));
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
  // Enter on the map itself drops a draft, and this one started on the bubble.
  await expect(page.locator(".draft-pin")).toHaveCount(0);
});

test("holding Enter on a focused cluster zooms in and drops no draft", async ({ page }) => {
  await serveOneCluster(page);
  await openMap(page);
  await page.getByRole("button", { name: "12 chatrooms", exact: true }).focus();
  await page.keyboard.down("Enter");
  await expect(page.locator(".leaflet-container")).toBeFocused();
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect.poll(() => tileZooms(page)).toEqual(["8"]);
  await expect(page.locator(".draft-pin")).toHaveCount(0);
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

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("a flight that raises the sheet makes one viewport request, once the map arrives", async ({ page, request }) => {
    const created = await request.post("/api/rooms", { data: { lat: -33.87, lng: 151.2 } });
    const { id } = (await created.json()) as { id: string };
    const requests = countViewportRequests(page);
    await openMap(page);
    await expect.poll(() => requests.length).toBe(1);

    await page.evaluate((room) => history.pushState(null, "", `/?room=${room}`), id);
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(3000);
    // The sheet ends a move in mid-air; a report then would ask for a zoom the flight is only passing.
    expect(requests.map((query) => query.get("zoom"))).toEqual(["5", "5"]);
  });
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
