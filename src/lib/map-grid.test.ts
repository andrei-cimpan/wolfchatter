import { describe, expect, it } from "vitest";
import { clusterCellBounds, clusterCellSize } from "./map-grid";

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

describe("clusterCellBounds", () => {
  // At zoom 5 a cell is 360 / 32 / 4 = 2.8125 degrees.
  const size = 2.8125;

  it("returns the cell that holds the cluster", () => {
    expect(clusterCellBounds({ lat: 48.5, lng: 20.1 }, 5, 20)).toEqual({
      west: 7 * size,
      south: 17 * size,
      east: 8 * size,
      north: 18 * size,
    });
  });

  it("rounds negative coordinates down, as the server's floor() does", () => {
    expect(clusterCellBounds({ lat: -0.5, lng: -0.5 }, 5, 0)).toEqual({
      west: -size,
      south: -size,
      east: 0,
      north: 0,
    });
  });

  it("moves the cell to the copy of the world nearest the view's centre", () => {
    const bounds = clusterCellBounds({ lat: 0.5, lng: -179.5 }, 5, 170);
    expect(bounds.west).toBeCloseTo(180, 12);
    expect(bounds.east).toBeCloseTo(180 + size, 12);
  });
});
