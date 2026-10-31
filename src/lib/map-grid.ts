// Grid clustering shared by the server, which groups rooms into cells, and the map, which zooms
// into the cell a cluster came from.
import { nearestWorldCopy } from "./bbox";
import type { Bbox } from "./types";

// From this zoom on, the viewport is small enough to return every room as-is.
export const CLUSTER_MAX_ZOOM = 16;

// About 64 px of a 256 px tile at this zoom. 180 / size is a whole number, so the cells at the
// edge of the map are full width. (No cell can span the antimeridian at any size: grouping by
// floor(lng / size) never puts 179.5 and -179.5 together.)
export function clusterCellSize(zoom: number): number {
  return (360 / 2 ** zoom) * 0.25;
}

/**
 * The grid cell a cluster was grouped into, on the copy of the world nearest `centerLng`.
 * A cluster sits at the average of its rooms, which is always inside their shared cell.
 */
export function clusterCellBounds(cluster: { lat: number; lng: number }, zoom: number, centerLng: number): Bbox {
  const size = clusterCellSize(zoom);
  const south = Math.floor(cluster.lat / size) * size;
  const west = Math.floor(cluster.lng / size) * size;
  const shift = nearestWorldCopy(cluster.lng, centerLng) - cluster.lng;
  return { west: west + shift, south, east: west + size + shift, north: south + size };
}
