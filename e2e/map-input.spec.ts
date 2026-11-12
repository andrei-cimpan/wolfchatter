import type { Page } from "@playwright/test";
import {
  CARD_FOCUS_X,
  CARD_SHIFT_PX,
  DRAFT_TITLE,
  EMPTY_STATE,
  ROOM_URL,
  ZOOM_5_PX_PER_DEGREE,
  countRoomPosts,
  createRoomAt,
  discard,
  draftPin,
  dragWithoutInertia,
  expectDraftPinTipAt,
  expectPinTipAt,
  expectPosition,
  expectWholeZoom,
  fillDraft,
  messageField,
  openMap,
  panel,
  pin,
  postRoom,
  postedRoomPosition,
  roomTitle,
  startDraftAt,
  submit,
} from "./chat-page";
import { expect, serveBlankTiles, test, tileZooms } from "./support";

// Clicks, double-clicks, taps and keys on the map: which drop a draft, and which only zoom or pan.

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

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

  test("holding Enter on Discard does not drop a new draft on the map that takes the focus", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await discard(page).focus();
    await page.keyboard.down("Enter");
    await expect(page.locator(".leaflet-container")).toBeFocused();
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await page.waitForTimeout(100);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  for (const key of ["Control+Enter", "Meta+Enter", "Alt+Enter", "Shift+Enter"]) {
    test(`${key} on the map drops no draft`, async ({ page }) => {
      await openMap(page);
      await page.locator(".leaflet-container").focus();
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
      await expect(draftPin(page)).toHaveCount(0);
    });
  }

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
});

test.describe("past the edge of the world", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("neither a click nor Enter there drops a draft, whose pin could not be drawn where it was asked", async ({
    page,
  }) => {
    const created = await page.request.post("/api/rooms", { data: { lat: 85, lng: 10 } });
    const { id, title } = (await created.json()) as { id: string; title: string };
    const map = page.locator(".leaflet-container");
    await openMap(page, `/?room=${id}`);
    await expect(pin(page, title)).toBeInViewport();
    await page.waitForTimeout(1500);

    // Six presses of 80 px put the map's centre well above the edge, which starts just above the pin.
    await map.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(roomTitle(page)).toHaveText(title);

    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(800);
    await map.click({ position: { x: 200, y: 50 } });
    await page.waitForTimeout(800);
    await expect(draftPin(page)).toHaveCount(0);
    await expect(roomTitle(page)).toHaveText(title);

    await startDraftAt(page, 200, 600);
  });
});
