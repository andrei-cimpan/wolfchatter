"use client";

import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteRoom } from "@/lib/api-client";
import { markRoomDeleted } from "./useRoom";
import { currentSelectedRoomId, selectRoom } from "./useSelectedRoom";

function deleteRoomKey(roomId: string) {
  return ["deleteRoom", roomId] as const;
}

/** Deletes the room, then closes it if it is still the one open. */
export function useDeleteRoom(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: deleteRoomKey(roomId),
    mutationFn: () => deleteRoom(roomId),
    onSuccess: () => {
      if (currentSelectedRoomId() === roomId) selectRoom(null);
      markRoomDeleted(queryClient, roomId);
    },
  });
}

/** Whether this page is deleting the room right now, from whichever button asked. */
export function useDeletingRoom(roomId: string): boolean {
  return useIsMutating({ mutationKey: deleteRoomKey(roomId) }) > 0;
}
