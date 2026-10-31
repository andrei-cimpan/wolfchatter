"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, createRoom } from "@/lib/api-client";
import type { Room } from "@/lib/types";
import { roomQueryKey } from "./useRoom";
import { selectRoom } from "./useSelectedRoom";

/** Creates a room, caches it so the panel shows it without a refetch, and selects it. */
export function useCreateRoom(onCreated: (room: Room) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRoom,
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKey(room.id), room);
      onCreated(room);
      selectRoom(room.id);
    },
  });
}

export function createRoomErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 429) {
    const wait = error.retryAfterSeconds;
    const when = wait === undefined ? "in a minute" : `in ${wait} second${wait === 1 ? "" : "s"}`;
    return `You're creating chatrooms too quickly. Try again ${when}.`;
  }
  return "Couldn't create the chatroom. Please try again.";
}
