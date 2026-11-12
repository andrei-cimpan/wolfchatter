"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useMapItems } from "@/hooks/useMapItems";
import { useRoom } from "@/hooks/useRoom";
import { useSelectedRoomId } from "@/hooks/useSelectedRoom";
import type { Draft, PinAnchor } from "@/lib/draft";
import { focusShiftPx, WIDE_SCREEN_QUERY } from "@/lib/map-focus";
import { INITIAL_VIEW, tileConfigFromEnv } from "@/lib/map-config";
import type { Bbox, MapItem } from "@/lib/types";
import { nextViewportQuery, type ViewportQuery } from "@/lib/viewport";
import { MapMarkers, type Cluster, type PinRoom } from "./MapMarkers";

const tileConfig = tileConfigFromEnv();

// Waits for the map to settle, so a drag or a run of zoom clicks makes one request, not one per step.
const VIEWPORT_DEBOUNCE_MS = 250;
const DOUBLE_CLICK_WAIT_MS = 500;
const EMPTY_MAP_CLICK_WAIT_MS = 250;

// Leaflet's projection stops here (its SphericalMercator.MAX_LATITUDE, missing from the types), but
// the map can be panned past it. A pin there would be drawn at this edge, away from where it was put.
const MAX_MAP_LATITUDE = 85.0511287798;
const isPastWorldEdge = (lat: number) => Math.abs(lat) > MAX_MAP_LATITUDE;

export interface LeafletMapProps {
  pinAnchor: PinAnchor | null;
  draft: Draft | null;
  onMapClick: (lat: number, lng: number) => void;
  onDoubleClickUndo: () => void;
  onRoomClick: (id: string) => void;
}

// Leaflet sends no click after a drag, so panning never drops a pin. The browser counts the clicks
// of a double-click in `detail`. A double-click zooms and should leave no pin, so a click waits to
// see if another follows. With a room or draft open the wait covers a typical double-click, since
// acting early would destroy it, and the flight would move the map before the zoom. On an empty map
// there is nothing to lose, so a pin comes sooner and a slower double-click takes it back. Anything
// else the user does during the wait (moving the map, going Back, or a pin click through `timerRef`)
// means they moved on, so the click drops nothing.
function ClickToDraft({
  timerRef,
  somethingOpen,
  onMapClick,
  onDoubleClickUndo,
}: Pick<LeafletMapProps, "onMapClick" | "onDoubleClickUndo"> & {
  timerRef: RefObject<ReturnType<typeof setTimeout> | undefined>;
  somethingOpen: boolean;
}) {
  const droppedByLastClick = useRef(false);
  const droppedBeforeThisClick = useRef(false);
  useEffect(() => {
    const cancel = () => clearTimeout(timerRef.current);
    window.addEventListener("popstate", cancel);
    return () => {
      window.removeEventListener("popstate", cancel);
      cancel();
    };
  }, [timerRef]);
  useMapEvents({
    dragstart: () => clearTimeout(timerRef.current),
    // Also a click on a cluster, which zooms.
    zoomstart: () => clearTimeout(timerRef.current),
    // Not in `click`, which a pin keeps to itself: the second click of a double-click can land on the
    // pin the first one dropped.
    preclick: () => {
      droppedBeforeThisClick.current = droppedByLastClick.current;
      droppedByLastClick.current = false;
    },
    click: (event) => {
      clearTimeout(timerRef.current);
      if (event.originalEvent.detail > 1) return;
      const { lat, lng } = event.latlng;
      if (isPastWorldEdge(lat)) return;
      timerRef.current = setTimeout(() => {
        droppedByLastClick.current = true;
        onMapClick(lat, lng);
      }, somethingOpen ? DOUBLE_CLICK_WAIT_MS : EMPTY_MAP_CLICK_WAIT_MS);
    },
    // Not only `detail`: some touch platforms always report 1, and Leaflet simulates this event.
    dblclick: () => {
      clearTimeout(timerRef.current);
      if (droppedBeforeThisClick.current) onDoubleClickUndo();
      droppedBeforeThisClick.current = false;
    },
  });
  return null;
}

// A click has no keyboard equivalent otherwise. The map is focusable for Leaflet's arrow-key panning,
// so Enter drops a pin where a selected room would land: the middle of what the card leaves clear.
// A focused pin or bubble handles its own Enter, and the event reaches the map as well. Leaflet also
// focuses the map on any press, so someone who typed a message and dragged the map may press Enter
// to send it, which must not replace their room or move their draft. `:focus-visible` cannot tell
// these apart: it can match after a drag too.
function EnterToDraft({ onMapClick }: Pick<LeafletMapProps, "onMapClick">) {
  const map = useMap();
  const focusFromPointer = useRef(false);
  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Map. Arrow keys move it, and Enter drops a pin at its centre.");
    let pressing = false;
    const onPress = () => {
      pressing = true;
      focusFromPointer.current = true;
    };
    const onRelease = () => {
      pressing = false;
    };
    const onFocus = () => {
      if (!pressing) focusFromPointer.current = false;
    };
    container.addEventListener("pointerdown", onPress);
    container.addEventListener("focus", onFocus);
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    return () => {
      container.removeEventListener("pointerdown", onPress);
      container.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
    };
  }, [map]);
  useMapEvents({
    keydown: ({ originalEvent: event }) => {
      // Not a repeat: Discard and a bubble's Enter move the focus here while the key is still down.
      if (event.key !== "Enter" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.target !== map.getContainer() || focusFromPointer.current) return;
      const { x, y } = map.getSize();
      const shiftX = focusShiftPx(map.getZoom(), window.matchMedia(WIDE_SCREEN_QUERY).matches);
      const { lat, lng } = map.containerPointToLatLng([x / 2 - shiftX, y / 2]);
      if (!isPastWorldEdge(lat)) onMapClick(lat, lng);
    },
  });
  return null;
}

// The mobile sheet changes the map's height, and the panel beside it on a phone on its side the
// map's width; Leaflet only notices window resizes on its own.
function KeepSizeInSync() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Reports the visible area straight away, then once the map stops moving. */
function TrackViewport({ onChange }: { onChange: (bounds: Bbox, zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const report = () => {
      // In mid-flight: a sheet resizing the map ends a move there. The landing reports instead.
      if (!Number.isInteger(map.getZoom())) return;
      const bounds = map.getBounds();
      onChange(
        { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
        map.getZoom(),
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reportLater = () => {
      clearTimeout(timer);
      timer = setTimeout(report, VIEWPORT_DEBOUNCE_MS);
    };
    report();
    map.on("moveend", reportLater);
    return () => {
      clearTimeout(timer);
      map.off("moveend", reportLater);
    };
  }, [map, onChange]);
  return null;
}

function splitItems(items: MapItem[]): { rooms: PinRoom[]; clusters: Cluster[] } {
  const rooms: PinRoom[] = [];
  const clusters: Cluster[] = [];
  for (const item of items) {
    if (item.type === "room") rooms.push(item);
    else clusters.push(item);
  }
  return { rooms, clusters };
}

export default function LeafletMap({ pinAnchor, draft, onMapClick, onDoubleClickUndo, onRoomClick }: LeafletMapProps) {
  const [viewport, setViewport] = useState<ViewportQuery | null>(null);
  const onViewChange = useCallback(
    (bounds: Bbox, zoom: number) => setViewport((current) => nextViewportQuery(current, bounds, zoom)),
    [],
  );
  const data = useMapItems(viewport);
  const { rooms, clusters } = splitItems(data?.items ?? []);
  // The open room always gets a pin, even when it is clustered, out of view, or not loaded yet.
  const selectedRoomId = useSelectedRoomId();
  const { data: selectedRoom } = useRoom(selectedRoomId);
  if (selectedRoom && !rooms.some((room) => room.id === selectedRoom.id)) rooms.push(selectedRoom);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  function pickRoom(id: string) {
    clearTimeout(clickTimerRef.current);
    onRoomClick(id);
  }

  return (
    <MapContainer center={INITIAL_VIEW.center} zoom={INITIAL_VIEW.zoom} className="h-full w-full">
      <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} />
      <ClickToDraft
        timerRef={clickTimerRef}
        somethingOpen={selectedRoomId !== null || draft !== null}
        onMapClick={onMapClick}
        onDoubleClickUndo={onDoubleClickUndo}
      />
      <EnterToDraft onMapClick={onMapClick} />
      <KeepSizeInSync />
      <TrackViewport onChange={onViewChange} />
      <MapMarkers
        rooms={rooms}
        clusters={clusters}
        clusterZoom={data?.zoom ?? 0}
        pinAnchor={pinAnchor}
        selectedRoomId={selectedRoomId}
        draft={selectedRoomId === null ? draft : null}
        onRoomClick={pickRoom}
      />
    </MapContainer>
  );
}
