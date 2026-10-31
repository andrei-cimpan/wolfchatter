import type { Bbox } from "./types";

// Leaflet keeps counting longitude past ±180 as the map is panned around the world.
// The range is half-open, [-180, 180), so the antimeridian has one spelling; normalizeBbox relies
// on 180 becoming -180. In-range values are returned untouched, and others move by whole turns
// in a single subtraction, because chained float arithmetic would turn 26.1 into 26.100000000000023.
export function wrapLongitude(lng: number): number {
  if (lng >= -180 && lng < 180) return lng;
  return lng - 360 * Math.floor((lng + 180) / 360);
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
  const lat = { south: clampLatitude(south), north: clampLatitude(north) };
  // The common case needs no arithmetic, which would otherwise nudge values like 1e-7.
  if (west <= east && west >= -180 && east <= 180) return { west, east, ...lat };

  const unwrappedEast = east >= west ? east : east + 360;
  if (unwrappedEast - west >= 360) return { west: -180, east: 180, ...lat };

  // Move both edges by the same whole number of turns so the span is preserved exactly.
  const wrappedWest = wrapLongitude(west);
  const wrappedEast = unwrappedEast - (west - wrappedWest);
  return { west: wrappedWest, east: wrappedEast > 180 ? wrappedEast - 360 : wrappedEast, ...lat };
}
