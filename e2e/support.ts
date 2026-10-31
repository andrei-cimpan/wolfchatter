import type { Page } from "@playwright/test";

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
