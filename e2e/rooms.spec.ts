import {
  CARD_FOCUS_X,
  DRAFT_NOTE,
  DRAFT_TITLE,
  EMPTY_STATE,
  ROOM_TITLE,
  ROOM_URL,
  countRoomPosts,
  createRoomAt,
  discard,
  draftPin,
  expectPinTipAt,
  expectPosition,
  fillDraft,
  holdRoomPost,
  messageField,
  openMap,
  panel,
  pin,
  postRoom,
  postedRoomPosition,
  roomTitle,
  startDraftAt,
  submit,
  trackPinX,
} from "./chat-page";
import { box, expect, makeTilesHitTestable, serveBlankTiles, test, tileZooms } from "./support";

// Drafts, creating rooms, selection and history, and the room panel's states.

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });


  test("a click drops a draft that saves nothing, and the first message creates the room", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expect(panel(page)).toContainText(DRAFT_NOTE);
    await expect(panel(page)).not.toContainText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveAttribute("title", "New chatroom (not created yet)");
    await expect(page).toHaveURL(/\/$/);
    expect(posts).toHaveLength(0);

    await fillDraft(page, "Hello from a new room");
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
    const title = (await roomTitle(page).textContent()) ?? "";
    await expect(pin(page, title)).toBeVisible();
    await expect(draftPin(page)).toHaveCount(0);
    await expect(panel(page)).not.toContainText(DRAFT_NOTE);
    await expect(panel(page).getByRole("log", { name: "Messages" })).toContainText("Hello from a new room");
    // The writer can carry on without clicking back in.
    await expect(messageField(page)).toBeFocused();
    await expect(messageField(page)).toHaveValue("");
    expect(posts).toHaveLength(1);
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

  test("a room created on a repeated copy of the world gets its pin where the click was", async ({
    page,
  }) => {
    await openMap(page);
    // From zoom 5 to 1: at 1280 px the view then spans more than one world, so x=1150 lies on
    // the copy east of the antimeridian (longitude above 180).
    for (const zoom of [4, 3, 2, 1]) {
      await page.getByRole("button", { name: "Zoom out" }).click();
      // Each click is ignored while the previous zoom animates, so wait for its tiles.
      await expect.poll(() => tileZooms(page)).toEqual([String(zoom)]);
    }
    await page.waitForTimeout(400);

    const track = trackPinX(page);
    const title = await createRoomAt(page, 1150, 300);
    const xs = await track;
    // The pin appears where the click was and flies from there. A hop to another copy of the
    // world would jump a whole world, 512 px at this zoom.
    expect(Math.abs((xs[0] ?? 0) - 1150)).toBeLessThan(40);
    for (let i = 1; i < xs.length; i++) expect(Math.abs((xs[i] ?? 0) - (xs[i - 1] ?? 0))).toBeLessThan(300);
    await expectPinTipAt(page, title, { x: CARD_FOCUS_X, y: 360 });
  });

  test("clicks while the first message is being sent are ignored", async ({ page }) => {
    const posts = countRoomPosts(page);
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page);
    await submit(page).click();
    await expect(panel(page).getByRole("status").filter({ hasText: "Creating a chatroom…" })).toBeVisible();
    await page.mouse.click(300, 500);
    await expect(page).toHaveURL(ROOM_URL);
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(1);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("picking a pin while a first message is being sent keeps that pick, and creating still works", async ({
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
    await startDraftAt(page, 600, 450);
    await fillDraft(page);
    await submit(page).click();
    await expect(panel(page).getByRole("status").filter({ hasText: "Creating a chatroom…" })).toBeVisible();
    await pin(page, first).click();
    await created;
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(firstUrl);
    await expect(roomTitle(page)).toHaveText(first);
    await expect(draftPin(page)).toHaveCount(0);

    slow = false;
    await createRoomAt(page, 800, 550);
    expect(posts).toHaveLength(3);
  });

  test("clicking the selected pin again adds no history entry", async ({ page }) => {
    await openMap(page);
    const title = await createRoomAt(page, 400, 300);
    const before = await page.evaluate(() => history.length);
    await pin(page, title).click();
    await pin(page, title).click();
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test("a creation error goes away with its draft", async ({ page }) => {
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } })
        : route.fallback(),
    );
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page);
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toHaveText("Couldn't create the chatroom. Please try again.");

    await discard(page).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await startDraftAt(page, 600, 450);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  });

  test("a rate-limited first message explains the wait, keeps the text and creates nothing", async ({ page }) => {
    let limited = true;
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST" && limited
        ? route.fulfill({
            status: 429,
            headers: { "Retry-After": "30" },
            json: { error: { code: "rate_limited", message: "Too many requests" } },
          })
        : route.fallback(),
    );
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Worth keeping");
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toHaveText(
      "You're creating chatrooms too quickly. Try again in 30 seconds.",
    );
    await expect(page).toHaveURL(/\/$/);
    await expect(draftPin(page)).toBeVisible();
    await expect(messageField(page)).toHaveValue("Worth keeping");

    limited = false;
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(panel(page).getByRole("log", { name: "Messages" })).toContainText("Worth keeping");
  });

  test("clicking elsewhere moves the draft and keeps what was typed", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Still here");
    await page.locator(".leaflet-container").click({ position: { x: 200, y: 600 } });
    await expect(async () => {
      const after = await draftPin(page).boundingBox();
      expect(Math.abs((after?.x ?? 0) + 12 - CARD_FOCUS_X)).toBeLessThan(3);
      expect(Math.abs((after?.y ?? 0) + 41 - 360)).toBeLessThan(3);
    }).toPass({ timeout: 10_000 });
    await expect(draftPin(page)).toHaveCount(1);
    await expect(messageField(page)).toHaveValue("Still here");
    expect(posts).toHaveLength(0);
  });

  test("the draft's pin is centred clear of the card, as a room's is", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 100, 600);
    await expect(async () => {
      const icon = await draftPin(page).boundingBox();
      expect(Math.abs((icon?.x ?? 0) + 12 - CARD_FOCUS_X)).toBeLessThan(3);
      expect(Math.abs((icon?.y ?? 0) + 41 - 360)).toBeLessThan(3);
    }).toPass({ timeout: 10_000 });
  });

  test("Discard removes the draft and saves nothing", async ({ page }) => {
    const posts = countRoomPosts(page);
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Never mind");
    await discard(page).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);

    await startDraftAt(page, 600, 450);
    await expect(messageField(page)).toHaveValue("");
  });

  test("opening a room discards the draft", async ({ page }) => {
    await openMap(page);
    const title = await createRoomAt(page, 400, 300);
    await startDraftAt(page, 200, 150);
    await pin(page, title).click();
    await expect(roomTitle(page)).toHaveText(title);
    await expect(draftPin(page)).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
  });

  test("Back from a draft over an open room returns to the room and ends the draft", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Half written");
    await expect(page).toHaveURL(/\/$/);

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    await expect(draftPin(page)).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a first message that fails after Back leaves no error for Forward to show", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Sent, then left");
    const failPost = await holdRoomPost(page);
    await submit(page).click();
    await expect(panel(page)).toContainText("Creating a chatroom…");

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    failPost();
    await expect(panel(page)).not.toContainText("Creating a chatroom…");

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a first message that fails after Back and Forward leaves no error either", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Sent, then left");
    const failPost = await holdRoomPost(page);
    await submit(page).click();
    await expect(panel(page)).toContainText("Creating a chatroom…");

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    failPost();

    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a draft ended by Back does not come back on an older entry", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await startDraftAt(page, 200, 600);
    await fillDraft(page, "Half written");

    await page.goBack();
    await expect(page).toHaveURL(ROOM_URL);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("saving a draft from the empty map leaves Back on the empty map", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("Discard shows as unavailable while the first message is on its way", async ({ page }) => {
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expect(discard(page)).not.toHaveAttribute("aria-disabled", "true");
    await fillDraft(page);
    await submit(page).click();
    await expect(discard(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page).toHaveURL(ROOM_URL);
  });

  test("a new room's message field takes the focus only once", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 400, 300);
    await expect(messageField(page)).toBeFocused();
    await page.goBack();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await page.goForward();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(messageField(page)).toBeVisible();
    // On a phone this would pop up the keyboard for someone who only went back to look.
    await expect(messageField(page)).not.toBeFocused();
  });

  test("Discard leaves the focus on the map, and the note is announced", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await expect(panel(page).getByRole("status").filter({ hasText: DRAFT_NOTE })).toBeVisible();
    await discard(page).click();
    await expect(page.locator(".leaflet-container")).toBeFocused();
  });

  test("a draft moved after closing a room still returns Back to that room once saved", async ({ page }) => {
    const room = await postRoom(page, { lat: 48, lng: 20 });
    await openMap(page, `/?room=${room.id}`);
    await startDraftAt(page, 200, 600);
    await page.locator(".leaflet-container").click({ position: { x: 700, y: 150 } });
    await page.waitForTimeout(700);
    await expect(draftPin(page)).toHaveCount(1);
    await fillDraft(page);
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(roomTitle(page)).toHaveText(ROOM_TITLE);

    await page.goBack();
    await expect(roomTitle(page)).toHaveText(room.title);
  });

  test("moving a draft clears a failed send's error and keeps the text", async ({ page }) => {
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "x" } } })
        : route.fallback(),
    );
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await fillDraft(page, "Try again");
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toBeVisible();

    await page.locator(".leaflet-container").click({ position: { x: 700, y: 150 } });
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    await expect(messageField(page)).toHaveValue("Try again");
  });

  test("reloading loses a draft", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 400, 300);
    await page.reload();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
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

  test("a room created near the bottom of the map stays in the part left visible by the sheet", async ({
    page,
  }) => {
    await openMap(page);
    const title = await createRoomAt(page, 300, 570);
    const map = await box(page, ".leaflet-container");
    await expectPinTipAt(page, title, { x: 375 / 2, y: map.y + map.height / 2 });
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

  test("a draft raises the sheet with the note and form on screen; the header's Discard lowers it", async ({
    page,
  }) => {
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 180, y: 250 } });
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await expect(panel(page)).toContainText(DRAFT_NOTE);
    const sheet = await box(page, "aside");
    expect(sheet.y + sheet.height).toBe(667);
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
    const button = await discard(page).boundingBox();
    expect(button?.height).toBeGreaterThanOrEqual(44);

    await discard(page).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("saving a draft never lowers the sheet, even for a frame", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 180, y: 250 } });
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await fillDraft(page);
    await page.evaluate(() => {
      const heights: number[] = [];
      Object.assign(window, { sheetHeights: heights });
      const sample = () => {
        heights.push(document.querySelector("aside")?.getBoundingClientRect().height ?? 0);
        requestAnimationFrame(sample);
      };
      sample();
    });
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(roomTitle(page)).toHaveText(ROOM_TITLE);
    await page.waitForTimeout(200);

    const heights = await page.evaluate(() => (window as unknown as { sheetHeights: number[] }).sheetHeights);
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeCloseTo(667 / 2, 0);
  });

  test("the close button shows as unavailable while a first message is on its way", async ({ page }) => {
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    });
    await openMap(page);
    await startDraftAt(page, 180, 250);
    await fillDraft(page);
    const close = page.getByRole("button", { name: "Close chat" });
    await expect(close).not.toHaveAttribute("aria-disabled", "true");
    await submit(page).click();
    await expect(close).toHaveAttribute("aria-disabled", "true");
    await expect(page).toHaveURL(ROOM_URL);
    await expect(close).not.toHaveAttribute("aria-disabled", "true");
  });

  test("the close button also discards a draft", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").click({ position: { x: 180, y: 250 } });
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("Enter on the map drops the draft at the map's centre, with no card to clear", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-container").focus();
    await page.keyboard.press("Enter");
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await fillDraft(page);
    const posted = postedRoomPosition(page);
    await submit(page).click();
    expectPosition(await posted, { lat: 48, lng: 20 });
  });

  test("the close button is a 44 px touch target", async ({ page }) => {
    await openMap(page);
    await createRoomAt(page, 180, 250);
    const close = await page.getByRole("button", { name: "Close chat" }).boundingBox();
    expect(close?.width).toBeGreaterThanOrEqual(44);
    expect(close?.height).toBeGreaterThanOrEqual(44);
  });
});
