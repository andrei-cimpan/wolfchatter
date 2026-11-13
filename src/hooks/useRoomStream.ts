"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { addMessage, catchUp } from "@/lib/message-cache";
import { connectRoomStream } from "@/lib/room-stream";
import { markRoomDeleted, roomQueryKey } from "./useRoom";

/**
 * Keeps the room's cached message list live while mounted: each new message is added as it
 * arrives, and every (re)connect catches up on what was sent while the stream was down. A deleted
 * room reads as not found from then on.
 */
export function useRoomStream(roomId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let reconnecting = false;
    return connectRoomStream(roomId, {
      onReady: () => {
        void catchUp(queryClient, roomId);
        // A deletion while the stream was down (a hidden tab, a lost connection) sent no event to
        // this page, so ask for the room again.
        if (reconnecting) void queryClient.invalidateQueries({ queryKey: roomQueryKey(roomId) });
        reconnecting = true;
      },
      onMessage: (message) => addMessage(queryClient, message),
      onClosed: () => markRoomDeleted(queryClient, roomId),
    });
  }, [queryClient, roomId]);
}
