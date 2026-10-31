import { wrapLongitude } from "@/lib/bbox";
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

/** The middle of a wrapped viewport, where west > east means it crosses the antimeridian. */
export function viewportCenter({ west, south, east, north }: Bbox): { lat: number; lng: number } {
  const unwrappedEast = west <= east ? east : east + 360;
  return { lat: (south + north) / 2, lng: wrapLongitude((west + unwrappedEast) / 2) };
}
