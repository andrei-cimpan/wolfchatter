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
  // keep until the flight ends. Null when no flight is under way.
  const flightZoom = useRef<number | null>(null);
  const flightDragged = useRef(false);

  useEffect(() => {
    if (selectedRoomId === null) placedRoomId.current = null;
    if (!target || placedRoomId.current === target.id) return;
    placedRoomId.current = target.id;
    const isPageOpen = roomAtOpen.current === target.id;
    roomAtOpen.current = null;

    const zoom = flightZoom.current ?? map.getZoom();
    const shiftX = focusShiftPx(zoom, window.matchMedia(WIDE_SCREEN_QUERY).matches);
    const center = map.unproject(map.project([target.lat, target.lng], zoom).add([shiftX, 0]), zoom);
    const animate = !isPageOpen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flightZoom.current = animate ? zoom : null;
    flightDragged.current = false;
    map.flyTo(center, zoom, { animate });
  });

  useMapEvents({
    dragstart: () => {
      flightDragged.current = true;
    },
    moveend: () => {
      const zoom = flightZoom.current;
      if (zoom === null) return;
      // Landed, or the wheel or a zoom button took over; both end on a whole zoom. A sheet resizing
      // the map also ends a move, in mid-air, and the flight carries on through that.
      if (Number.isInteger(map.getZoom())) flightZoom.current = null;
      // A drag is the one thing that stops a flight and leaves the map between zooms.
      else if (flightDragged.current) {
        flightZoom.current = null;
        map.setZoom(zoom);
      }
    },
  });
}
