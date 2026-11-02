"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useMapItems } from "@/hooks/useMapItems";
import { useRoom } from "@/hooks/useRoom";
import { useSelectedRoomId } from "@/hooks/useSelectedRoom";
import { INITIAL_VIEW, tileConfigFromEnv } from "@/lib/map-config";
import type { Bbox, MapItem } from "@/lib/types";
import { nextViewportQuery, type ViewportQuery } from "@/lib/viewport";
import { MapMarkers, type Cluster, type DraftPosition, type PinAnchor, type PinRoom } from "./MapMarkers";

export type { PinAnchor } from "./MapMarkers";

const tileConfig = tileConfigFromEnv();

// Waits for the map to settle, so a drag or a run of zoom clicks makes one request, not one per step.
const VIEWPORT_DEBOUNCE_MS = 250;
const DOUBLE_CLICK_WAIT_MS = 500;
const EMPTY_MAP_CLICK_WAIT_MS = 250;

export interface LeafletMapProps {
  pinAnchor: PinAnchor | null;
  draft: DraftPosition | null;
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
    click: (event) => {
      clearTimeout(timerRef.current);
      const dropped = droppedByLastClick.current;
      droppedByLastClick.current = false;
      if (event.originalEvent.detail > 1) {
        if (dropped) onDoubleClickUndo();
        return;
      }
      const { lat, lng } = event.latlng;
      timerRef.current = setTimeout(() => {
        droppedByLastClick.current = true;
        onMapClick(lat, lng);
      }, somethingOpen ? DOUBLE_CLICK_WAIT_MS : EMPTY_MAP_CLICK_WAIT_MS);
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
