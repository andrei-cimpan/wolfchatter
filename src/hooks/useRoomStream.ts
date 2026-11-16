"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getDing } from "@/lib/ding";
import { addMessage, catchUp } from "@/lib/message-cache";
import { alertFor, browserAlertDeps, isInFront, showAlert } from "@/lib/message-alert";
import { getNotifyPreference } from "@/lib/notify-preference";
import { connectRoomStream } from "@/lib/room-stream";
import type { Room } from "@/lib/types";
import { useMyUserId } from "./useMyUserId";
import { markRoomDeleted, roomQueryKey } from "./useRoom";

/**
 * Keeps the room's cached message list live while mounted: each new message is added as it
 * arrives, and every (re)connect catches up on what was sent while the stream was down. A deleted
 * room reads as not found from then on. A live message from someone else dings, and notifies too
 * when the tab is not in front, if this browser turned that on; catch-up stays silent.
 */
export function useRoomStream(roomId: string): void {
  const queryClient = useQueryClient();
  const myId = useMyUserId();
  // Read when a message arrives, so signing in or out does not resubscribe the channel.
  const myIdRef = useRef(myId);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);

  useEffect(
    () =>
      connectRoomStream(roomId, {
        onReady: () => {
          void catchUp(queryClient, roomId);
          // A deletion while no channel listened sent this page nothing: before it opened the room
          // (a cached room never goes stale), or while the stream was down (a lost connection). So
          // every ready, the first included, asks for the room again.
          void queryClient.invalidateQueries({ queryKey: roomQueryKey(roomId) });
        },
        onMessage: (message, posterId) => {
          addMessage(queryClient, message);
          const kind = alertFor({
            posterId,
            myId: myIdRef.current,
            enabled: getNotifyPreference().get(),
            inFront: isInFront(document),
          });
          const room = queryClient.getQueryData<Room | null>(roomQueryKey(roomId));
          showAlert(kind, message, room?.title ?? null, browserAlertDeps(getDing()));
        },
        onClosed: () => markRoomDeleted(queryClient, roomId),
      }),
    [queryClient, roomId],
  );
}
