"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getRoom } from "@/lib/api-client";
import { shouldRetryQuery } from "@/lib/query-retry";
import { roomIdSchema } from "@/lib/schemas";
import { MAP_ITEMS_KEY } from "./useMapItems";

export function roomQueryKey(id: string) {
  return ["room", id] as const;
}

/** The room was deleted: it reads as not found, and the map drops its pin on the next fetch. */
export function markRoomDeleted(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData(roomQueryKey(id), null);
  void queryClient.invalidateQueries({ queryKey: MAP_ITEMS_KEY });
}

/** `data` is `null` when the room does not exist, including when the id is malformed. */
export function useRoom(id: string | null) {
  return useQuery({
    queryKey: roomQueryKey(id ?? ""),
    // The API answers 404 for a malformed id too, so skip the request and give the same answer.
    queryFn: () => (roomIdSchema.safeParse(id).success ? getRoom(id!) : null),
    enabled: id !== null,
    retry: shouldRetryQuery,
    // Title and position never change. messageCount does, but the UI does not show it.
    staleTime: Infinity,
  });
}
