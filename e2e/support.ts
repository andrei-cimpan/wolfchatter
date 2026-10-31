import { test as base, expect, type Page } from "@playwright/test";

// The browser logs every non-2xx response, and some tests trigger a 404, 429 or 500 on purpose.
const EXPECTED_CONSOLE_ERRORS = [/^Failed to load resource: the server responded with a status of (404|429|500)/];

/**
 * Fails any test whose page throws or logs a console error, such as React's hydration mismatch,
 * which otherwise only shows in the dev server log while the test passes.
 */
export const test = base.extend<{ failOnBrowserErrors: void }>({
  failOnBrowserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (!EXPECTED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) errors.push(`console.error: ${text}`);
      });
      await use();
      expect(errors, "browser errors during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// A 1x1 PNG served for every off-site image, whichever basemap the dev server is configured with:
// the tests stay offline and off tile providers' servers (whose policies forbid automated load),
// yet the map still has real tiles that could cover the panel.
const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export async function serveBlankTiles(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const request = route.request();
    const offSite = new URL(request.url()).hostname !== "localhost";
    return request.resourceType() === "image" && offSite
      ? route.fulfill({ contentType: "image/png", body: BLANK_TILE })
      : route.fallback();
  });
}

/** Leaflet makes tiles ignore the pointer, which would hide them from elementFromPoint. */
export async function makeTilesHitTestable(page: Page): Promise<void> {
  await page.addStyleTag({ content: ".leaflet-tile { pointer-events: auto !important; }" });
}

export async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} is not visible`);
  return b;
}
