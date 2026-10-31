"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiError, createRoom, retryAfterPhrase } from "@/lib/api-client";
import type { Room } from "@/lib/types";
import { MAP_ITEMS_KEY } from "./useMapItems";
import { roomQueryKey } from "./useRoom";
import { currentSelectedRoomId, selectRoom } from "./useSelectedRoom";

type CreateRoomVariables = {
  lat: number;
  lng: number;
  /** `?room` when the click happened: decides whether the result may still change the selection. */
  selectedAtClick: string | null;
  /** Pin clicks so far; a pin clicked during creation, even the current room's, is the user's choice. */
  picksAtClick: number;
};

/**
 * Creates a room where the map was clicked, caches it so the panel shows it without a refetch,
 * refreshes the map's pins, and selects it unless the user picked another room while it was being created.
 */
export function useCreateRoom(onCreated: (room: Room, clickedLng: number) => void) {
  const queryClient = useQueryClient();
  // A ref, not `isPending`: two clicks can land before React re-renders with the new state.
  const creatingRef = useRef(false);
  const picksRef = useRef(0);

  const mutation = useMutation({
    mutationFn: ({ lat, lng }: CreateRoomVariables) => createRoom({ lat, lng }),
    onSuccess: (room, { lng, selectedAtClick, picksAtClick }) => {
      queryClient.setQueryData(roomQueryKey(room.id), room);
      // The new room may join a cluster, which only the server can tell, so refetch the viewport.
      // Until then the map still pins it if it is selected, as it always pins the open room.
      void queryClient.invalidateQueries({ queryKey: MAP_ITEMS_KEY });
      onCreated(room, lng);
      const userMovedOn = currentSelectedRoomId() !== selectedAtClick || picksRef.current !== picksAtClick;
      if (!userMovedOn) selectRoom(room.id);
    },
    // Hook-level, not per-call: per-call callbacks are skipped once the observer moves on.
    onSettled: () => {
      creatingRef.current = false;
    },
  });

  function create(lat: number, lng: number) {
    // One room at a time: ignore clicks while the previous room is still being created.
    if (creatingRef.current) return;
    creatingRef.current = true;
    mutation.mutate({ lat, lng, selectedAtClick: currentSelectedRoomId(), picksAtClick: picksRef.current });
  }

  /** Selects a room the user picked (a pin click), which a room still being created must not override. */
  function pick(id: string) {
    picksRef.current += 1;
    selectRoom(id);
  }

  return {
    create,
    pick,
    isPending: mutation.isPending,
    error: mutation.error,
    /** The error belongs to the selection it happened on; navigating away hides it. */
    errorSelection: mutation.variables?.selectedAtClick ?? null,
  };
}

export function createRoomErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 429) {
    return `You're creating chatrooms too quickly. Try again ${retryAfterPhrase(error)}.`;
  }
  return "Couldn't create the chatroom. Please try again.";
}
