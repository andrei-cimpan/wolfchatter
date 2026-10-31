"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { StaticImageData } from "next/image";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useRoom } from "@/hooks/useRoom";
import { useSelectedRoomId } from "@/hooks/useSelectedRoom";
import { nearestWorldCopy } from "@/lib/bbox";
import { INITIAL_VIEW, tileConfigFromEnv } from "@/lib/map-config";
import type { Room } from "@/lib/types";

const tileConfig = tileConfigFromEnv();

// Next types image imports as StaticImageData, but Turbopack gives a plain URL for these.
function assetUrl(image: StaticImageData | string): string {
  return typeof image === "string" ? image : image.src;
}

// Leaflet finds its default pin images through a CSS path that bundling breaks, so point the
// same images (and sizes) at the URLs the bundler emits.
const pinIcon = new L.Icon({
  iconUrl: assetUrl(iconUrl),
  iconRetinaUrl: assetUrl(iconRetinaUrl),
  shadowUrl: assetUrl(shadowUrl),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
});

/** The longitude a room was clicked at, possibly on a repeated copy of the world. */
export type PinAnchor = { roomId: string; lng: number };

export interface LeafletMapProps {
  createdRooms: Room[];
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

// Rooms store a wrapped longitude, but the map repeats the world sideways. Each pin is drawn on the
// copy nearest the view's centre, recomputed after every move. At low zoom several copies are on
// screen at once, so the room just created stays on the copy that was clicked until the user
// drags or zooms. Not on any move: raising the mobile sheet moves the map too.
function RoomPins({
  rooms,
  pinAnchor,
  onRoomClick,
}: Pick<LeafletMapProps, "pinAnchor" | "onRoomClick"> & { rooms: Room[] }) {
  const map = useMap();
  const [centerLng, setCenterLng] = useState(() => map.getCenter().lng);
  const [releasedAnchor, setReleasedAnchor] = useState<PinAnchor | null>(null);
  useMapEvents({
    moveend: () => setCenterLng(map.getCenter().lng),
    dragstart: () => setReleasedAnchor(pinAnchor),
    zoomstart: () => setReleasedAnchor(pinAnchor),
  });
  const anchor = pinAnchor !== releasedAnchor ? pinAnchor : null;

  return rooms.map((room) => (
    <Marker
      key={room.id}
      position={[room.lat, nearestWorldCopy(room.lng, room.id === anchor?.roomId ? anchor.lng : centerLng)]}
      icon={pinIcon}
      title={room.title}
      alt={room.title}
      eventHandlers={{
        click: () => onRoomClick(room.id),
        // Leaflet makes pins focusable buttons but only handles Enter when a popup is bound.
        keydown: (event) => {
          const { key } = event.originalEvent;
          if (key !== "Enter" && key !== " ") return;
          event.originalEvent.preventDefault();
          onRoomClick(room.id);
        },
      }}
    />
  ));
}

export default function LeafletMap({ createdRooms, pinAnchor, onMapClick, onRoomClick }: LeafletMapProps) {
  const { data: selectedRoom } = useRoom(useSelectedRoomId());
  const rooms =
    selectedRoom && !createdRooms.some((room) => room.id === selectedRoom.id)
      ? [...createdRooms, selectedRoom]
      : createdRooms;

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
      <RoomPins rooms={rooms} pinAnchor={pinAnchor} onRoomClick={onRoomClick} />
    </MapContainer>
  );
}
