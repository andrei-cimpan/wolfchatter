import type { Page } from "@playwright/test";
import { EMPTY_STATE, messages, panel, submit } from "./chat-page";
import { box, expect, makeTilesHitTestable, serveBlankTiles, test } from "./support";

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

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.locator("aside").evaluate((aside) => aside.scrollWidth - aside.clientWidth);
  expect(overflow).toBe(0);
}

const MIN_LIST_PX = 80;

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

async function post(page: Page) {
  await panel(page).getByRole("textbox", { name: "Message" }).fill("Sent from here");
  await submit(page).click();
  await expect(messages(page).getByRole("listitem").last()).toContainText("Sent from here");
}

async function expectSelectedPinTipAt(page: Page, point: { x: number; y: number }) {
  const title = panel(page).getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Chatroom \d+$/);
  const pin = page.getByRole("button", { name: (await title.textContent()) ?? "", exact: true });
  await expect(async () => {
    const icon = await pin.boundingBox();
    // The icon's tip is 12 px right of its left edge and 41 px below its top.
    expect(Math.abs((icon?.x ?? 0) + 12 - point.x)).toBeLessThan(3);
    expect(Math.abs((icon?.y ?? 0) + 41 - point.y)).toBeLessThan(3);
  }).toPass({ timeout: 10_000 });
}

async function expectPostWorks(page: Page) {
  await post(page);
  await expect(messages(page).getByRole("listitem").last()).toBeInViewport({ ratio: 0.9 });
}

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 568, height: 276 },
]) {
  test.describe(`errors on a short screen, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("a failed post's error comes fully into view", async ({ page }) => {
      await openFullRoom(page);
      await page.route("**/messages", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "down" } } })
          : route.fallback(),
      );
      await panel(page).getByRole("textbox", { name: "Message" }).fill("Will fail");
      await submit(page).click();

      await expect(panel(page).getByRole("alert")).toBeInViewport({ ratio: 1 });
      // Only the panel may scroll; `main` hides its overflow, so a scroll there could not be undone.
      expect(await page.locator("main").evaluate((main) => main.scrollTop)).toBe(0);
      await expectNoPageScroll(page);
    });
  });
}

test.describe("errors in a very short draft", () => {
  test.use({ viewport: { width: 568, height: 200 } });

  test("a failed room creation's error comes into view", async ({ page }) => {
    await page.route("**/api/rooms", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "down" } } })
        : route.fallback(),
    );
    await page.goto("/");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    // High up and to the right: in a window this short, Next's dev badge covers the lower left.
    await page.locator(".leaflet-container").click({ position: { x: 400, y: 60 } });
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("New chatroom");
    await panel(page).getByRole("textbox", { name: "Message" }).fill("Will fail");
    await submit(page).click();

    await expect(panel(page).getByRole("alert")).toBeInViewport({ ratio: 1 });
  });
});

for (const { width, height } of [
  { width: 320, height: 180 },
  { width: 300, height: 260 },
  { width: 360, height: 320 },
]) {
  test.describe(`narrow panel beside the map, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("Submit wraps below the message field rather than squeezing it", async ({ page }) => {
      await openFullRoom(page);
      const textWidth = await panel(page).getByRole("textbox", { name: "Message" }).evaluate((field) => {
        const style = getComputedStyle(field);
        return field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      expect(textWidth).toBeGreaterThanOrEqual(80);
      await expectNoSidewaysScroll(page);
    });
  });
}

for (const { width, height } of [
  { width: 360, height: 400 },
  { width: 300, height: 310 },
]) {
  test.describe(`short upright window, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("the sheet leaves room for the map's zoom buttons and attribution", async ({ page }) => {
      await openFullRoom(page);
      await expect(page.getByRole("button", { name: "Zoom out" })).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".leaflet-control-attribution")).toBeInViewport({ ratio: 1 });
      expect((await box(page, "aside")).y + (await box(page, "aside")).height).toBe(height);
      await expectNoPageScroll(page);
    });
  });
}

for (const { width, height, x, y } of [
  { width: 320, height: 568, x: 160, y: 150 },
  { width: 568, height: 320, x: 400, y: 100 },
  { width: 1280, height: 720, x: 400, y: 300 },
]) {
  test.describe(`a draft at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("shows the note, the form and Discard without scrolling", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".leaflet-container")).toBeVisible();
      await page.locator(".leaflet-container").click({ position: { x, y } });
      await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("New chatroom");
      await expect(panel(page).getByText("Send the first message to create this chatroom.")).toBeInViewport({ ratio: 1 });
      await expect(submit(page)).toBeInViewport({ ratio: 1 });
      await expect(panel(page).getByRole("button", { name: "Discard" })).toBeInViewport({ ratio: 1 });
      await expectNoPageScroll(page);
    });
  });
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
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("New chatroom");
    await panel(page).getByRole("textbox", { name: "Message" }).fill("Hello");
    await submit(page).click();
    await expectSelectedPinTipAt(page, { x: 667 / 4, y: 375 / 2 });
  });

  test("closing the chat gives the whole width back to the map", async ({ page }) => {
    await openFullRoom(page);
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(panel(page)).toHaveText(EMPTY_STATE);

    const map = await box(page, ".leaflet-container");
    expect(map.width).toBe(667);
    expect(map.y + map.height).toBeLessThanOrEqual((await box(page, "aside")).y);

    // Leaflet loaded tiles only for the narrow map; without invalidateSize() the strip the chat
    // uncovers stays grey. Sampled top right, clear of the attribution box.
    await makeTilesHitTestable(page);
    await expect
      .poll(() => page.evaluate(() => document.elementFromPoint(640, 20)?.classList.contains("leaflet-tile") ?? false))
      .toBe(true);
  });
});

test.describe("rotating a phone with a room open", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("the chat moves beside the map and back, and the pin stays centred", async ({ page }) => {
    await openFullRoom(page);
    await expectSelectedPinTipAt(page, { x: 375 / 2, y: (667 - 667 / 2) / 2 });

    await page.setViewportSize({ width: 667, height: 375 });
    expect(await box(page, "aside")).toEqual({ x: 667 / 2, y: 0, width: 667 / 2, height: 375 });
    await expectSelectedPinTipAt(page, { x: 667 / 4, y: 375 / 2 });
    await expectUsableChat(page, 375);

    await page.setViewportSize({ width: 375, height: 667 });
    const sheet = await box(page, "aside");
    expect(sheet.width).toBe(375);
    expect(sheet.y + sheet.height).toBe(667);
    await expectSelectedPinTipAt(page, { x: 375 / 2, y: (667 - 667 / 2) / 2 });
    await expectUsableChat(page, 667);
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

test.describe("large phone on its side, under a notch", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("the card and Submit stay clear of the notch", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 47, bottom: 21, right: 47 } });
    await openFullRoom(page);
    const card = await box(page, "aside");
    expect(card.x + card.width).toBe(844 - 47);
    const button = await submit(page).boundingBox();
    expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(844 - 47);
  });
});

// The switch from the sheet to the panel beside the map is at 500 px high, and to the card at 768 px wide.
test.describe("layout boundaries", () => {
  for (const { width, height, expected } of [
    { width: 767, height: 500, expected: { x: 383.5, y: 0, width: 383.5, height: 500 } },
    { width: 767, height: 501, expected: { x: 0, y: 181, width: 767, height: 320 } },
    { width: 768, height: 500, expected: { x: 372, y: 16, width: 380 } },
  ]) {
    test.describe(`${width}x${height}`, () => {
      test.use({ viewport: { width, height } });

      test("the panel takes the layout for its size, with a usable chat", async ({ page }) => {
        await openFullRoom(page);
        expect(await box(page, "aside")).toMatchObject(expected);
        await expectUsableChat(page, height);
      });
    });
  }
});

test.describe("desktop card in a quiet room", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the card fits its one message, with no minimum height for the list", async ({ page }) => {
    const response = await page.request.post("/api/rooms", { data: { lat: 48, lng: 20 } });
    const { id } = (await response.json()) as { id: string };
    await page.request.post(`/api/rooms/${id}/messages`, { data: { author: "bo", body: "Only message" } });
    await page.goto(`/?room=${id}`);
    await expect(messages(page).getByRole("listitem")).toHaveCount(1);
    expect(await listHeight(page)).toBeLessThan(MIN_LIST_PX);
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
  });
});

for (const { width, height, layout } of [
  { width: 800, height: 200, layout: "card" },
  { width: 300, height: 260, layout: "beside the map" },
  { width: 300, height: 310, layout: "sheet" },
]) {
  test.describe(`very short window, ${layout}, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("the panel scrolls, so Submit stays reachable and the list keeps its room", async ({ page }) => {
      await openFullRoom(page);
      expect(await listHeight(page)).toBeGreaterThanOrEqual(MIN_LIST_PX);
      await expect(submit(page)).not.toBeInViewport({ ratio: 1 });

      // A real wheel: Playwright's own click scrolls even a panel that a person could not scroll.
      await panel(page).getByRole("heading", { level: 2 }).hover();
      await page.mouse.wheel(0, 600);
      await expect(submit(page)).toBeInViewport({ ratio: 1 });
      await post(page);

      // The form and a whole message may not both fit, so the reader scrolls back up to read it.
      await submit(page).hover();
      await page.mouse.wheel(0, -600);
      await expect(messages(page).getByRole("listitem").last()).toBeInViewport({ ratio: 0.9 });
      await expectNoPageScroll(page);
    });
  });
}
