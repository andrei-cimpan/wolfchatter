"use client";

import { useQuery } from "@tanstack/react-query";
import { getRoom } from "@/lib/api-client";
import { roomIdSchema } from "@/lib/schemas";

export function roomQueryKey(id: string) {
  return ["room", id] as const;
}

/** `data` is `null` when the room does not exist, including when the id is malformed. */
export function useRoom(id: string | null) {
  return useQuery({
    queryKey: roomQueryKey(id ?? ""),
    // The API answers 404 for a malformed id too, so skip the request and give the same answer.
    queryFn: () => (roomIdSchema.safeParse(id).success ? getRoom(id!) : null),
    enabled: id !== null,
    // Room fields never change after creation (the message count is refreshed elsewhere).
    staleTime: Infinity,
  });
}
