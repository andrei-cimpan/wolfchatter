"use client";

import { useSearchParams } from "next/navigation";

const ROOM_PARAM = "room";

/** The `?room` value as written, valid or not; `useRoom` decides whether it names a room. */
export function useSelectedRoomId(): string | null {
  return useSearchParams().get(ROOM_PARAM) || null;
}

/**
 * Switches the selected room, adding a history entry so Back returns to the previous room.
 * Next.js syncs native pushState with useSearchParams, without a server round trip.
 */
export function selectRoom(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(ROOM_PARAM, id);
  else url.searchParams.delete(ROOM_PARAM);
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
