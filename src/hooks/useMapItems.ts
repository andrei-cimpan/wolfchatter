"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listMapItems } from "@/lib/api-client";
import type { ViewportQuery } from "@/lib/viewport";
import { shouldRetryRoomQuery } from "./useRoom";

/** Prefix of every viewport's key, for invalidating them all when a room is created. */
export const MAP_ITEMS_KEY = ["mapItems"] as const;

export function mapItemsQueryKey({ bbox, zoom }: ViewportQuery) {
  return [...MAP_ITEMS_KEY, bbox.west, bbox.south, bbox.east, bbox.north, zoom] as const;
}

/**
 * Rooms and clusters for the viewport. While the next viewport loads, the previous one's pins stay
 * on screen so they do not flicker; if loading fails, they simply stay. The result carries the zoom
 * it was clustered at, which a kept-on-screen result does not share with the current query.
 */
export function useMapItems(query: ViewportQuery | null) {
  const result = useQuery({
    queryKey: query ? mapItemsQueryKey(query) : MAP_ITEMS_KEY,
    queryFn: async () => ({ zoom: query!.zoom, items: await listMapItems(query!) }),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    retry: shouldRetryRoomQuery,
    // Other users' new rooms show up when the user comes back to an area after this long.
    staleTime: 30_000,
  });
  // keepPreviousData covers only a pending query; once the new one fails, `data` is undefined and
  // the map would look empty. So remember the last result that loaded (React's "adjust state
  // during render" pattern) and show it instead.
  const [lastLoaded, setLastLoaded] = useState(result.data);
  if (result.data !== undefined && result.data !== lastLoaded) setLastLoaded(result.data);
  return result.data ?? lastLoaded;
}
