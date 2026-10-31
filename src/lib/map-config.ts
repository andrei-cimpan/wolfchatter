import type { LatLngTuple } from "leaflet";

export interface TileConfig {
  url: string;
  /** Rendered by Leaflet as HTML, so it must come from operator config, never from users. */
  attribution: string;
}

export const DEFAULT_TILES: TileConfig = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

/** Matches the mockups: central and eastern Europe. */
export const INITIAL_VIEW: { center: LatLngTuple; zoom: number } = {
  center: [48, 20],
  zoom: 5,
};

/**
 * Picks the basemap from optional overrides. Blank values mean "use the default".
 * A custom URL without its own attribution throws, because showing OpenStreetMap's credit
 * under another provider's tiles would be wrong and showing none breaks most tile licences.
 */
export function resolveTileConfig(env: { url?: string; attribution?: string }): TileConfig {
  const url = env.url?.trim() || undefined;
  const attribution = env.attribution?.trim() || undefined;
  if (url && !attribution) {
    throw new Error(
      "NEXT_PUBLIC_MAP_TILE_URL is set, so NEXT_PUBLIC_MAP_ATTRIBUTION must be set too",
    );
  }
  return {
    url: url ?? DEFAULT_TILES.url,
    attribution: attribution ?? DEFAULT_TILES.attribution,
  };
}

/**
 * Reads the basemap from the environment. `next.config.ts` calls it at startup, so a bad
 * value stops `next dev` and `next build` before any page can crash in the browser.
 */
export function tileConfigFromEnv(): TileConfig {
  // Next.js inlines NEXT_PUBLIC_* into client code only when each variable is written out literally.
  return resolveTileConfig({
    url: process.env.NEXT_PUBLIC_MAP_TILE_URL,
    attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
  });
}
