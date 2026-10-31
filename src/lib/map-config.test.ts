import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TILES, resolveTileConfig } from "./map-config";

describe("basemap env validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubUrlWithoutAttribution() {
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL", "https://tiles.example.com/{z}/{x}/{y}.png");
    vi.stubEnv("NEXT_PUBLIC_MAP_ATTRIBUTION", "");
    vi.resetModules();
  }

  // A bad basemap must stop `next dev` and `next build`, not crash the page in the browser.
  it("fails when next.config loads", async () => {
    stubUrlWithoutAttribution();
    await expect(import("../../next.config")).rejects.toThrow(/NEXT_PUBLIC_MAP_ATTRIBUTION/);
  });

  it("does not run when map-config is imported", async () => {
    stubUrlWithoutAttribution();
    await expect(import("./map-config")).resolves.toBeDefined();
  });
});

describe("resolveTileConfig", () => {
  it("uses OpenStreetMap when nothing is set", () => {
    expect(resolveTileConfig({})).toEqual(DEFAULT_TILES);
  });

  it("treats empty and whitespace-only values as unset", () => {
    expect(resolveTileConfig({ url: "", attribution: "   " })).toEqual(DEFAULT_TILES);
  });

  it("uses a custom URL and attribution, trimmed", () => {
    expect(
      resolveTileConfig({
        url: " https://tiles.example.com/{z}/{x}/{y}.png ",
        attribution: " © Example ",
      }),
    ).toEqual({ url: "https://tiles.example.com/{z}/{x}/{y}.png", attribution: "© Example" });
  });

  it("rejects a custom URL without an attribution", () => {
    expect(() => resolveTileConfig({ url: "https://tiles.example.com/{z}/{x}/{y}.png" })).toThrow(
      /NEXT_PUBLIC_MAP_ATTRIBUTION/,
    );
  });

  it("allows overriding only the attribution", () => {
    expect(resolveTileConfig({ attribution: "© Someone" })).toEqual({
      url: DEFAULT_TILES.url,
      attribution: "© Someone",
    });
  });
});
