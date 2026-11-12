import {
  CARD_FOCUS_X,
  createRoomAt,
  dragWithoutInertia,
  expectPinTipAt,
  expectWholeZoom,
  expectZoomKept,
  openMap,
  pin,
  postRoom,
  roomTitle,
  selectInPage,
  trackPinX,
} from "./chat-page";
import { expect, serveBlankTiles, test, tileZooms } from "./support";

// Flying the map to the selected pin, and the zoom it ends on.

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

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
