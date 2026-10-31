import { describe, expect, it } from "vitest";
import { longitudeRanges } from "./map-grid";

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
