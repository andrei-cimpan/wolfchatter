"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useMapItems } from "@/hooks/useMapItems";
import { useRoom } from "@/hooks/useRoom";
import { useSelectedRoomId } from "@/hooks/useSelectedRoom";
import { INITIAL_VIEW, tileConfigFromEnv } from "@/lib/map-config";
import type { Bbox, MapItem } from "@/lib/types";
import { nextViewportQuery, type ViewportQuery } from "@/lib/viewport";
import { MapMarkers, type Cluster, type PinAnchor, type PinRoom } from "./MapMarkers";

export type { PinAnchor } from "./MapMarkers";

const tileConfig = tileConfigFromEnv();

// Waits for the map to settle, so a drag or a run of zoom clicks makes one request, not one per step.
const VIEWPORT_DEBOUNCE_MS = 250;

export interface LeafletMapProps {
  pinAnchor: PinAnchor | null;
  onMapClick: (lat: number, lng: number) => void;
  onRoomClick: (id: string) => void;
}

// Leaflet sends no click after a drag, so panning never creates a room. The browser counts the
// clicks of a double-click in `detail`; only the first one creates a room.
function ClickToCreate({ onMapClick }: Pick<LeafletMapProps, "onMapClick">) {
  useMapEvents({
    click: (event) => {
      if (event.originalEvent.detail > 1) return;
      onMapClick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

// The mobile sheet changes the map's height; Leaflet only notices window resizes on its own.
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

export default function LeafletMap({ pinAnchor, onMapClick, onRoomClick }: LeafletMapProps) {
  const [viewport, setViewport] = useState<ViewportQuery | null>(null);
  const onViewChange = useCallback(
    (bounds: Bbox, zoom: number) => setViewport((current) => nextViewportQuery(current, bounds, zoom)),
    [],
  );
  const data = useMapItems(viewport);
  const { rooms, clusters } = splitItems(data?.items ?? []);
  // The open room always gets a pin, even when it is clustered, out of view, or not loaded yet.
  const { data: selectedRoom } = useRoom(useSelectedRoomId());
  if (selectedRoom && !rooms.some((room) => room.id === selectedRoom.id)) rooms.push(selectedRoom);

  return (
    <MapContainer
      center={INITIAL_VIEW.center}
      zoom={INITIAL_VIEW.zoom}
      // A double-click must not also zoom: its first click already creates a room (ClickToCreate
      // ignores the second), so zooming as well would move the map away from the new pin.
      doubleClickZoom={false}
      className="h-full w-full"
    >
      <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} />
      <ClickToCreate onMapClick={onMapClick} />
      <KeepSizeInSync />
      <TrackViewport onChange={onViewChange} />
      <MapMarkers
        rooms={rooms}
        clusters={clusters}
        clusterZoom={data?.zoom ?? 0}
        pinAnchor={pinAnchor}
        onRoomClick={onRoomClick}
      />
    </MapContainer>
  );
}
