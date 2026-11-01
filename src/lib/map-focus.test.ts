import { describe, expect, it } from "vitest";
import { focusShiftPx } from "./map-focus";

describe("focusShiftPx", () => {
  it("does not shift on a narrow screen, where nothing covers the map", () => {
    expect(focusShiftPx(0, false)).toBe(0);
    expect(focusShiftPx(5, false)).toBe(0);
  });

  it("shifts by half of what the card covers on a wide screen", () => {
    expect(focusShiftPx(5, true)).toBe(198);
    expect(focusShiftPx(1, true)).toBe(198);
  });

  it("stays under half a world, so the pin stays on the copy nearest the map's centre", () => {
    // The world is 256 px wide at zoom 0.
    expect(focusShiftPx(0, true)).toBeLessThan(128);
    expect(focusShiftPx(0, true)).toBeGreaterThan(100);
  });
});
