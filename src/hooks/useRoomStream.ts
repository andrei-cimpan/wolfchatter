"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { addMessage, catchUp } from "@/lib/message-cache";
import { connectRoomStream } from "@/lib/room-stream";

/**
 * Keeps the room's cached message list live while mounted: each new message is added as it
 * arrives, and every (re)connect catches up on what was sent while the stream was down.
 */
export function useRoomStream(roomId: string): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      connectRoomStream(roomId, {
        onReady: () => void catchUp(queryClient, roomId),
        onMessage: (message) => addMessage(queryClient, message),
      }),
    [queryClient, roomId],
  );
}
