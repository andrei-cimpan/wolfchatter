import { describe, expect, it } from "vitest";
import { nearestWorldCopy, normalizeBbox, wrapLongitude } from "./bbox";

const lat = { south: -10, north: 10 };

describe("nearestWorldCopy", () => {
  it.each([
    // [stored lng, view centre lng, lng to draw at]
    [18.28, 0, 18.28],
    [18.28, 370, 378.28],
    [18.28, -350, -341.72],
    [170, -170, -190],
    [-170, 175, 190],
    [10, 200, 370],
  ])("draws %d near a view centred on %d at %d", (lng, center, expected) => {
    expect(nearestWorldCopy(lng, center)).toBeCloseTo(expected, 9);
  });

  it("stays within half a world of the view centre", () => {
    for (const center of [-700, -181, 0, 179, 540]) {
      expect(Math.abs(nearestWorldCopy(-179, center) - center)).toBeLessThanOrEqual(180);
    }
  });
});

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
    expect(wrapLongitude(input)).toBe(expected);
  });

  // Modulo arithmetic turned 26.1 into 26.100000000000023, so rooms were saved slightly off.
  it.each([26.1, -0.1, 1e-7, -179.999999, 179.123456789])("keeps the in-range longitude %d exactly", (lng) => {
    expect(wrapLongitude(lng)).toBe(lng);
  });

  it("moves an out-of-range longitude by whole turns only", () => {
    expect(wrapLongitude(200.5)).toBe(-159.5);
    expect(wrapLongitude(-200.25)).toBe(159.75);
  });

  // Next to a wrap boundary, (lng + 180) / 360 can round up to a whole number, which used to give
  // -180.0000000000001: outside the database's check constraint, so creating the room was a 500.
  it("stays within [-180, 180) right next to every wrap boundary", () => {
    for (let turn = -5; turn <= 5; turn++) {
      const boundary = turn * 360 + 180;
      for (const lng of [nextDown(boundary), boundary, nextUp(boundary)]) {
        const wrapped = wrapLongitude(lng);
        expect(wrapped, `wrapLongitude(${lng})`).toBeGreaterThanOrEqual(-180);
        expect(wrapped, `wrapLongitude(${lng})`).toBeLessThan(180);
      }
    }
    expect(wrapLongitude(899.9999999999999)).toBeGreaterThanOrEqual(-180);
  });
});

// The neighbouring doubles, so boundary tests probe the exact values where rounding flips.
function nextUp(x: number): number {
  return stepDouble(x, 1);
}
function nextDown(x: number): number {
  return stepDouble(x, -1);
}
function stepDouble(x: number, direction: 1 | -1): number {
  if (x === 0) return direction * Number.MIN_VALUE;
  const bits = new BigInt64Array(new Float64Array([x]).buffer);
  bits[0] = bits[0]! + BigInt(Math.sign(x) * direction);
  return new Float64Array(bits.buffer)[0]!;
}

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
