"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

/** The room to bring into view, with `lng` on the copy of the world its pin is drawn on. */
export type FlyTarget = { id: string; lat: number; lng: number };

// RoomPanel's card from `md` up: 380 px wide plus its 16 px margin, floating over the map's right
// edge. Below `md` the sheet shrinks the map instead of covering it, so the centre is always clear.
const WIDE_SCREEN = "(min-width: 768px)";
const CARD_COVER_PX = 396;

/**
 * Brings the selected room into view whenever the selection changes, at the current zoom. A page
 * opened on a room starts there rather than flying in from the default view.
 */
export function useFlyToRoom(selectedRoomId: string | null, target: FlyTarget | undefined) {
  const map = useMap();
  const roomAtOpen = useRef(selectedRoomId);
  // Not every render: the target's longitude changes as the map moves.
  const placedRoomId = useRef<string | null>(null);

  useEffect(() => {
    if (selectedRoomId === null) placedRoomId.current = null;
    if (!target || placedRoomId.current === target.id) return;
    placedRoomId.current = target.id;
    const isPageOpen = roomAtOpen.current === target.id;
    roomAtOpen.current = null;

    const zoom = map.getZoom();
    const shiftX = window.matchMedia(WIDE_SCREEN).matches ? CARD_COVER_PX / 2 : 0;
    const center = map.unproject(map.project([target.lat, target.lng], zoom).add([shiftX, 0]), zoom);
    const animate = !isPageOpen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.flyTo(center, zoom, { animate });
  });
}
