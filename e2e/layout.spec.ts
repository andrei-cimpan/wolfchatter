import { expect, test, type Page } from "@playwright/test";

const EMPTY_STATE = "Click on the map to start a chat";

// A 1x1 PNG served for every tile: the tests stay offline and off OpenStreetMap's servers (whose
// tile policy forbids automated load), yet the map still has real tiles that could cover the panel.
const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ contentType: "image/png", body: BLANK_TILE }),
  );
});

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} is not visible`);
  return b;
}

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
    // Leaflet makes tiles ignore the pointer, which would hide them from elementFromPoint.
    await page.addStyleTag({ content: ".leaflet-tile { pointer-events: auto !important; }" });
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
    await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
    await expectNoPageScroll(page);
  });
});
