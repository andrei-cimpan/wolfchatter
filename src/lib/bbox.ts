import type { Bbox } from "./types";

// Leaflet keeps counting longitude past ±180 as the map is panned around the world.
export function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function clampLatitude(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

/**
 * Returns bounds with longitudes in [-180, 180], where west > east means the viewport crosses
 * the antimeridian. That is the only form the repository understands.
 *
 * Accepts Leaflet's unwrapped bounds (west <= east, possibly beyond ±180) and bounds that are
 * already wrapped and crossing (west > east, both within ±180). Latitudes are clamped because
 * the client pads the viewport, which can push them past the poles.
 */
export function normalizeBbox({ west, south, east, north }: Bbox): Bbox {
  const span = east >= west ? east - west : east + 360 - west;
  const lat = { south: clampLatitude(south), north: clampLatitude(north) };
  if (span >= 360) return { west: -180, east: 180, ...lat };

  const wrappedWest = wrapLongitude(west);
  const wrappedEast = wrappedWest + span;
  return { west: wrappedWest, east: wrappedEast > 180 ? wrappedEast - 360 : wrappedEast, ...lat };
}
