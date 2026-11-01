"use client";

import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { focusShiftPx, WIDE_SCREEN_QUERY } from "@/lib/map-focus";

/** The room to bring into view, with `lng` on the copy of the world its pin is drawn on. */
export type FlyTarget = { id: string; lat: number; lng: number };

/**
 * Brings the selected room into view whenever the selection changes, at the current zoom. A page
 * opened on a room starts there rather than flying in from the default view.
 */
export function useFlyToRoom(selectedRoomId: string | null, target: FlyTarget | undefined) {
  const map = useMap();
  const roomAtOpen = useRef(selectedRoomId);
  // Not every render: the target's longitude changes as the map moves.
  const placedRoomId = useRef<string | null>(null);
  // A flight passes through fractional zooms and getZoom() reports them, so this is the zoom to
  // keep. A landed flight is on it already, so only the user zooming makes it out of date.
  const flightZoom = useRef<number | null>(null);
  const flightDragged = useRef(false);

  useEffect(() => {
    if (selectedRoomId === null) placedRoomId.current = null;
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
      const zoom = flightZoom.current;
      // Only after a drag: a sheet resizing the map also ends a move in mid-air, and a flight
      // carries on through that. A drag is what stops a flight and leaves the map between zooms.
      if (zoom === null || !flightDragged.current || Number.isInteger(map.getZoom())) return;
      map.setZoom(zoom);
      flightZoom.current = zoom;
    },
  });
}
