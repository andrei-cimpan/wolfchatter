import { describe, expect, it } from "vitest";
import { clusterCellSize, longitudeRanges } from "./map-grid";

describe("clusterCellSize", () => {
  it.each([
    [0, 90],
    [2, 22.5],
    [10, 360 / 1024 / 4],
    [15, 360 / 32768 / 4],
  ])("at zoom %d is %d degrees", (zoom, size) => {
    expect(clusterCellSize(zoom)).toBeCloseTo(size, 12);
  });

  it("puts cell edges exactly on the antimeridian", () => {
    for (let zoom = 0; zoom < 16; zoom++) {
      expect(Number.isInteger(180 / clusterCellSize(zoom))).toBe(true);
    }
  });
});

describe("longitudeRanges", () => {
  it("returns the viewport range for a normal viewport", () => {
    expect(longitudeRanges({ west: 10, east: 30 })).toEqual([
      { from: 10, to: 30 },
      { from: 10, to: 30 },
    ]);
  });

  it("splits a viewport that crosses the antimeridian", () => {
    expect(longitudeRanges({ west: 170, east: -170 })).toEqual([
      { from: 170, to: 180 },
      { from: -180, to: -170 },
    ]);
  });

  it("keeps a whole-world viewport as one range", () => {
    expect(longitudeRanges({ west: -180, east: 180 })[0]).toEqual({ from: -180, to: 180 });
  });
});
