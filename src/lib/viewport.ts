import { MAX_ZOOM } from "./limits";
import type { Bbox } from "./types";

/** What the map asks `GET /api/rooms` for. */
export type ViewportQuery = { bbox: Bbox; zoom: number };

// Each side gains a tenth of the view's span, so a small pan stays inside what was loaded. Snapping
// to tiles adds more, and the server caps a response at 500 cells, so more padding would crowd out
// cells in view.
const PADDING = 0.1;

/**
 * Turns the map's visible bounds (Leaflet's, so longitudes may run past ±180) into the query for
 * its pins. The padded edges snap outward to whole tiles at that zoom, so a small pan or a raised
 * mobile sheet gives the same query, and the cached result is reused instead of refetched.
 * Longitudes stay unwrapped; the API wraps them.
 */
export function viewportQuery(bounds: Bbox, zoom: number): ViewportQuery {
  const z = Math.min(MAX_ZOOM, Math.max(0, Math.round(zoom)));
  // A power-of-two fraction of 360, so multiples of it are exact in floating point.
  const step = 360 / 2 ** z;
  const padLng = (bounds.east - bounds.west) * PADDING;
  const padLat = (bounds.north - bounds.south) * PADDING;
  const west = Math.floor((bounds.west - padLng) / step) * step;
  const east = Math.ceil((bounds.east + padLng) / step) * step;
  const south = Math.max(-90, Math.floor((bounds.south - padLat) / step) * step);
  const north = Math.min(90, Math.ceil((bounds.north + padLat) / step) * step);
  // Zoomed far out the view spans the world more than once; one spelling keeps one cache entry.
  const lng = east - west >= 360 ? { west: -180, east: 180 } : { west, east };
  return { bbox: { ...lng, south, north }, zoom: z };
}

/**
 * Keeps the current query while the view stays inside what it loaded at the same zoom. Snapping
 * alone is not enough: a pan of a few pixels can still push a padded edge across a tile boundary.
 */
export function nextViewportQuery(current: ViewportQuery | null, bounds: Bbox, zoom: number): ViewportQuery {
  const next = viewportQuery(bounds, zoom);
  if (!current || current.zoom !== next.zoom) return next;
  const loaded = current.bbox;
  const covered =
    bounds.west >= loaded.west &&
    bounds.east <= loaded.east &&
    bounds.south >= loaded.south &&
    bounds.north <= loaded.north;
  return covered ? current : next;
}
