"use client";

import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { focusShiftPx, WIDE_SCREEN_QUERY } from "@/lib/map-focus";

/** The room to bring into view, with `lng` on the copy of the world its pin is drawn on. */
export type FlyTarget = { id: string; lat: number; lng: number };

/**
 * Brings the focused pin into view whenever the focus changes, at the current zoom. `focusId` is
 * the open draft's id, or else the selected room's, or `null` when neither is open. A page opened
 * on a room starts there rather than flying in from the default view.
 */
export function useFlyToRoom(focusId: string | null, target: FlyTarget | undefined) {
  const map = useMap();
  const roomAtOpen = useRef(focusId);
  // Not every render: the target's longitude changes as the map moves.
  const placedRoomId = useRef<string | null>(null);
  // A flight passes through fractional zooms and getZoom() reports them, so this is the zoom to
  // keep. A landed flight is on it already, so only the user zooming makes it out of date.
  const flightZoom = useRef<number | null>(null);
  const flightDragged = useRef(false);

  useEffect(() => {
    if (focusId === null) placedRoomId.current = null;
    if (!target || placedRoomId.current === target.id) return;
    placedRoomId.current = target.id;
    const isPageOpen = roomAtOpen.current === target.id;
    roomAtOpen.current = null;

    // Rounded because the user may have just zoomed in mid-air, and that zoom is still animating.
    const zoom = flightZoom.current ?? Math.round(map.getZoom());
    const shiftX = focusShiftPx(zoom, window.matchMedia(WIDE_SCREEN_QUERY).matches);
    const center = map.unproject(map.project([target.lat, target.lng], zoom).add([shiftX, 0]), zoom);
    const animate = !isPageOpen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flightDragged.current = false;
    map.flyTo(center, zoom, { animate });
    flightZoom.current = zoom;
  });

  useMapEvents({
    // The wheel, the buttons, a pinch and a cluster click all end on a whole zoom of their own.
    zoomstart: () => {
      flightZoom.current = null;
    },
    dragstart: () => {
      flightDragged.current = true;
    },
    moveend: () => {
      // Only after a drag: a sheet resizing the map also ends a move in mid-air, and a flight
      // carries on through that. A drag is what stops a flight and leaves the map between zooms,
      // apart from a two-finger tap whose fingers do not move, which ends no move for this to see.
      // Real fingers nearly always move, and the next drag or zoom puts it right.
      if (!flightDragged.current || Number.isInteger(map.getZoom())) return;
      // Rounded when no zoom is known: a button's zoom starts a frame after its click, so its
      // zoomstart can clear the zoom of a flight begun in between, which it does not stop.
      const zoom = flightZoom.current ?? Math.round(map.getZoom());
      map.setZoom(zoom);
      flightZoom.current = zoom;
    },
  });
}
