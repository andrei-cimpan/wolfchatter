import { describe, expect, it } from "vitest";
import { DEFAULT_TILES, resolveTileConfig } from "./map-config";

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
