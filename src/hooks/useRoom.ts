"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getRoom } from "@/lib/api-client";
import { roomIdSchema } from "@/lib/schemas";

export function roomQueryKey(id: string) {
  return ["room", id] as const;
}

/**
 * One retry for a network failure or server error. TanStack's default of three with backoff kept
 * "Loading chatroom…" on screen for about 7 seconds; a 4xx will not fix itself, so never retry it.
 */
export function shouldRetryRoomQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 1;
}

/** `data` is `null` when the room does not exist, including when the id is malformed. */
export function useRoom(id: string | null) {
  return useQuery({
    queryKey: roomQueryKey(id ?? ""),
    // The API answers 404 for a malformed id too, so skip the request and give the same answer.
    queryFn: () => (roomIdSchema.safeParse(id).success ? getRoom(id!) : null),
    enabled: id !== null,
    retry: shouldRetryRoomQuery,
    // Title and position never change. messageCount does, but the UI does not show it.
    staleTime: Infinity,
  });
}
