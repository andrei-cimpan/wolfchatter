import { describe, expect, it } from "vitest";
import { nextViewportQuery, viewportQuery } from "./viewport";

// At zoom 5 a tile is 360 / 32 = 11.25 degrees wide.
const TILE = 11.25;

describe("viewportQuery", () => {
  it("pads the view by a fifth of its span on each side, then snaps out to whole tiles", () => {
    // Span 20 x 10, padded by 4 and 2: west 6, east 34, south 38, north 52.
    expect(viewportQuery({ west: 10, south: 40, east: 30, north: 50 }, 5)).toEqual({
      bbox: { west: 0, south: 3 * TILE, east: 4 * TILE, north: 5 * TILE },
      zoom: 5,
    });
  });

  it("gives the same query after a small pan, so the cached pins are reused", () => {
    const before = viewportQuery({ west: 10, south: 40, east: 30, north: 50 }, 5);
    const after = viewportQuery({ west: 11, south: 40.5, east: 31, north: 50.5 }, 5);
    expect(after).toEqual(before);
  });

  it("always covers the visible bounds", () => {
    const bounds = { west: -3.7, south: 12.1, east: 8.9, north: 19.4 };
    const { bbox } = viewportQuery(bounds, 7);
    expect(bbox.west).toBeLessThanOrEqual(bounds.west);
    expect(bbox.east).toBeGreaterThanOrEqual(bounds.east);
    expect(bbox.south).toBeLessThanOrEqual(bounds.south);
    expect(bbox.north).toBeGreaterThanOrEqual(bounds.north);
  });

  it("keeps longitudes past the antimeridian unwrapped, for the API to wrap", () => {
    const { bbox } = viewportQuery({ west: 170, south: 0, east: 190, north: 10 }, 5);
    expect(bbox.west).toBe(14 * TILE);
    expect(bbox.east).toBe(18 * TILE);
  });

  it("clamps latitudes at the poles", () => {
    const { bbox } = viewportQuery({ west: 0, south: -85, east: 40, north: 85 }, 3);
    expect(bbox.south).toBe(-90);
    expect(bbox.north).toBe(90);
  });

  it("spells a view that spans the whole world once, whatever copy it is on", () => {
    const one = viewportQuery({ west: -300, south: -60, east: 200, north: 60 }, 1);
    const other = viewportQuery({ west: 60, south: -60, east: 560, north: 60 }, 1);
    expect(one.bbox).toMatchObject({ west: -180, east: 180 });
    expect(other).toEqual(one);
  });

  it("rounds and clamps the zoom to what the API accepts", () => {
    expect(viewportQuery({ west: 0, south: 0, east: 1, north: 1 }, 5.6).zoom).toBe(6);
    expect(viewportQuery({ west: 0, south: 0, east: 1, north: 1 }, -1).zoom).toBe(0);
    expect(viewportQuery({ west: 0, south: 0, east: 1, north: 1 }, 30).zoom).toBe(22);
  });
});

describe("nextViewportQuery", () => {
  const view = { west: 10, south: 40, east: 30, north: 50 };
  const loaded = viewportQuery(view, 5);

  it("starts from the view when nothing is loaded yet", () => {
    expect(nextViewportQuery(null, view, 5)).toEqual(loaded);
  });

  it("keeps the same query while the view stays inside what was loaded", () => {
    // Snapping alone would move the padded west edge (6 - 8 = -2) into the tile west of 0.
    const panned = { west: 2, south: 41, east: 22, north: 51 };
    expect(viewportQuery(panned, 5)).not.toEqual(loaded);
    expect(nextViewportQuery(loaded, panned, 5)).toBe(loaded);
  });

  it("asks again once the view leaves what was loaded", () => {
    const farther = { west: -5, south: 40, east: 15, north: 50 };
    expect(nextViewportQuery(loaded, farther, 5)).toEqual(viewportQuery(farther, 5));
  });

  it("asks again at a new zoom, even inside what was loaded", () => {
    expect(nextViewportQuery(loaded, view, 6)).toEqual(viewportQuery(view, 6));
  });
});
