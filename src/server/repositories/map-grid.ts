import type { Bbox } from "@/lib/types";

// From this zoom on, the viewport is small enough to return every room as-is.
export const CLUSTER_MAX_ZOOM = 16;
export const MAP_ITEMS_LIMIT = 500;

// About 64 px of a 256 px tile at this zoom. 180 / size is a whole number, so the cells at the
// edge of the map are full width. (No cell can span the antimeridian at any size: grouping by
// floor(lng / size) never puts 179.5 and -179.5 together.)
export function clusterCellSize(zoom: number): number {
  return (360 / 2 ** zoom) * 0.25;
}

export type LngRange = { from: number; to: number };

// A viewport with west > east crosses the antimeridian and covers two longitude ranges.
export function longitudeRanges({ west, east }: Pick<Bbox, "west" | "east">): [LngRange, LngRange] {
  if (west <= east) return [{ from: west, to: east }, { from: west, to: east }];
  return [
    { from: west, to: 180 },
    { from: -180, to: east },
  ];
}
