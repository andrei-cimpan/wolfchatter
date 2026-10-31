import type { Bbox } from "@/lib/types";

export const MAP_ITEMS_LIMIT = 500;

export type LngRange = { from: number; to: number };

// A viewport with west > east crosses the antimeridian and covers two longitude ranges.
export function longitudeRanges({ west, east }: Pick<Bbox, "west" | "east">): [LngRange, LngRange] {
  if (west <= east) return [{ from: west, to: east }, { from: west, to: east }];
  return [
    { from: west, to: 180 },
    { from: -180, to: east },
  ];
}
