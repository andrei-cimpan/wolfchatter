"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createRoom } from "@/lib/api-client";
import type { Draft } from "@/lib/draft";
import { messagesQueryKey } from "@/lib/message-cache";
import type { Room } from "@/lib/types";
import { MAP_ITEMS_KEY } from "./useMapItems";
import { roomQueryKey } from "./useRoom";
import { currentSelectedRoomId, replaceSelectedRoom, selectRoom } from "./useSelectedRoom";

type CreateRoomVariables = {
  lat: number;
  lng: number;
  author: string;
  body: string;
  /** `?room` when the message was sent: decides whether the result may still change the selection. */
  selectedAtSend: string | null;
  /** Pin clicks so far; a pin clicked while sending, even the current room's, is the user's choice. */
  picksAtSend: number;
  replaceEntry: boolean;
};

type DraftToSend = Pick<Draft, "lat" | "lng" | "openedOverRoom">;

/**
 * Creates a room from a draft and its first message, caches both so the panel shows them without a
 * refetch, refreshes the map's pins, and selects the room unless the user picked another one meanwhile.
 */
export function useCreateRoom(
  onCreated: (room: Room, clickedLng: number, userMovedOn: boolean) => void,
  onAbandonedSendFailed: () => void,
) {
  const queryClient = useQueryClient();
  // A ref, not `isPending`: a second Enter can land before React re-renders with the new state.
  const sendingRef = useRef(false);
  const picksRef = useRef(0);
  const abandonedRef = useRef(false);

  const mutation = useMutation({
    mutationFn: ({ lat, lng, author, body }: CreateRoomVariables) =>
      createRoom({ lat, lng, firstMessage: { author, body } }),
    onSuccess: ({ firstMessage, ...room }, { lng, selectedAtSend, picksAtSend, replaceEntry }) => {
      queryClient.setQueryData(roomQueryKey(room.id), room);
      queryClient.setQueryData(messagesQueryKey(room.id), [firstMessage]);
      // The new room may join a cluster, which only the server can tell, so refetch the viewport.
      // Until then the map still pins it if it is selected, as it always pins the open room.
      void queryClient.invalidateQueries({ queryKey: MAP_ITEMS_KEY });
      const userMovedOn = currentSelectedRoomId() !== selectedAtSend || picksRef.current !== picksAtSend;
      onCreated(room, lng, userMovedOn);
      if (userMovedOn) return;
      if (replaceEntry) replaceSelectedRoom(room.id);
      else selectRoom(room.id);
    },
    // Hook-level, not per-call: per-call callbacks are skipped once the observer moves on.
    onSettled: (_data, error) => {
      sendingRef.current = false;
      if (error && abandonedRef.current) onAbandonedSendFailed();
    },
  });

  /** Sends the draft's first message unless one is already on its way. */
  function send(draft: DraftToSend, author: string, body: string, onSent: () => void) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    abandonedRef.current = false;
    mutation.mutate(
      {
        lat: draft.lat,
        lng: draft.lng,
        author,
        body,
        selectedAtSend: currentSelectedRoomId(),
        picksAtSend: picksRef.current,
        replaceEntry: draft.openedOverRoom,
      },
      { onSuccess: onSent },
    );
  }

  /** Selects a room the user picked (a pin click), which a room still being created must not override. */
  function pick(id: string) {
    picksRef.current += 1;
    selectRoom(id);
  }

  /**
   * Back or Forward during a send: its form is gone, and a new one would be empty, so a failure has
   * nothing to explain the error beside. Not on the selection, which Forward can put back as it was.
   */
  function abandonSend() {
    abandonedRef.current = true;
  }

  /** Forgets the last result. Not while sending: a reset would drop that send's `onSent`. */
  function clearResult() {
    if (!sendingRef.current) mutation.reset();
  }

  return {
    send,
    pick,
    abandonSend,
    clearResult,
    /** For callbacks: true from the moment of sending, before React re-renders. */
    isSending: () => sendingRef.current,
    isPending: mutation.isPending,
    error: mutation.error,
    /** The room this hook just created, whose form takes the focus so the writer can carry on. */
    createdRoomId: mutation.data?.id ?? null,
  };
}
