"use client";

import { useQuery } from "@tanstack/react-query";
import { listMessages } from "@/lib/api-client";
import { messagesQueryKey } from "@/lib/message-cache";
import { shouldRetryQuery } from "@/lib/query-retry";

/**
 * The room's latest page of messages, oldest first. The live stream (`useRoomStream`) adds new
 * ones; the default staleTime of 0 still refetches it when the window regains focus or the room is
 * reopened, which covers a stream that keeps failing.
 */
export function useMessages(roomId: string) {
  return useQuery({
    queryKey: messagesQueryKey(roomId),
    queryFn: () => listMessages(roomId),
    retry: shouldRetryQuery,
  });
}
