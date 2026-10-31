import { describe, expect, it } from "vitest";
import { normalizeBbox, wrapLongitude } from "./bbox";

const lat = { south: -10, north: 10 };

describe("wrapLongitude", () => {
  it.each([
    [0, 0],
    [179.5, 179.5],
    [180, -180],
    [190, -170],
    [-190, 170],
    [530, 170],
    [-540, -180],
  ])("wraps %d to %d", (input, expected) => {
    expect(wrapLongitude(input)).toBeCloseTo(expected, 10);
  });
});

describe("normalizeBbox", () => {
  it("returns in-range decimal bounds bit-for-bit unchanged", () => {
    const bounds = { west: 26.1, south: 44.39, east: 26.123456789, north: 44.41 };
    expect(normalizeBbox(bounds)).toEqual(bounds);
  });

  it("leaves a normal viewport alone", () => {
    expect(normalizeBbox({ west: 10, east: 30, ...lat })).toEqual({ west: 10, east: 30, ...lat });
  });

  it.each([
    ["Leaflet east of the antimeridian", 170, 190],
    ["Leaflet west of the antimeridian", -190, -170],
    ["already wrapped", 170, -170],
    ["several worlds away", 530, 550],
  ])("turns a crossing viewport (%s) into west > east", (_label, west, east) => {
    expect(normalizeBbox({ west, east, ...lat })).toEqual({ west: 170, east: -170, ...lat });
  });

  it("wraps a viewport that sits entirely in another world copy", () => {
    expect(normalizeBbox({ west: 370, east: 390, ...lat })).toEqual({ west: 10, east: 30, ...lat });
  });

  it("handles already-wrapped crossing bounds starting at 180", () => {
    expect(normalizeBbox({ west: 180, east: -170, ...lat })).toEqual({ west: -180, east: -170, ...lat });
  });

  it("keeps an east edge of exactly 180", () => {
    expect(normalizeBbox({ west: 170, east: 180, ...lat })).toEqual({ west: 170, east: 180, ...lat });
  });

  it.each([
    [-180, 180],
    [-300, 200],
    // Exactly 360° but not from -180: must not collapse to a zero-width box.
    [10, 370],
    [-170, 190],
  ])("returns the whole world for a span of 360° or more (%d..%d)", (west, east) => {
    expect(normalizeBbox({ west, east, ...lat })).toEqual({ west: -180, east: 180, ...lat });
  });

  it("clamps padded latitudes to the poles", () => {
    expect(normalizeBbox({ west: 0, east: 10, south: -95, north: 97 })).toEqual({
      west: 0,
      east: 10,
      south: -90,
      north: 90,
    });
  });
});
