"use client";

import L, { type LeafletKeyboardEvent } from "leaflet";
import type { StaticImageData } from "next/image";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { useMemo, useState } from "react";
import { Marker, useMap, useMapEvents } from "react-leaflet";
import { nearestWorldCopy } from "@/lib/bbox";
import { clusterBubble } from "@/lib/cluster-bubble";
import { CLUSTER_MAX_ZOOM, clusterCellBounds } from "@/lib/map-grid";
import type { Room } from "@/lib/types";

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

export type PinRoom = Pick<Room, "id" | "title" | "lat" | "lng">;
export type Cluster = { lat: number; lng: number; count: number };

// Leaflet makes markers focusable buttons but only handles Enter when a popup is bound.
function onEnterOrSpace(action: () => void) {
  return (event: LeafletKeyboardEvent) => {
    const { key } = event.originalEvent;
    if (key !== "Enter" && key !== " ") return;
    event.originalEvent.preventDefault();
    action();
  };
}

function ClusterMarker({ cluster, zoom, centerLng }: { cluster: Cluster; zoom: number; centerLng: number }) {
  const map = useMap();
  const { label, text, size } = clusterBubble(cluster.count);
  // A new icon on every render would rebuild the element and drop keyboard focus.
  const icon = useMemo(
    () =>
      L.divIcon({
        // `text` is digits (and "k") built from a number, never user input. aria-hidden lets the
        // marker's title, "N chatrooms", be its accessible name instead of the bare number.
        html: `<span aria-hidden="true"${text.length > 2 ? ' class="long"' : ""}>${text}</span>`,
        className: "cluster-bubble",
        iconSize: [size, size],
      }),
    [text, size],
  );
  const zoomIn = () => {
    const { west, south, east, north } = clusterCellBounds(cluster, zoom, centerLng);
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { maxZoom: CLUSTER_MAX_ZOOM },
    );
  };
  // The zoom replaces this bubble, and focus on a removed element falls back to the page's start.
  // The map container is focusable (Leaflet's keyboard panning), so keyboard users stay on the map.
  const zoomInFromKeyboard = () => {
    zoomIn();
    map.getContainer().focus({ preventScroll: true });
  };

  return (
    <Marker
      position={[cluster.lat, nearestWorldCopy(cluster.lng, centerLng)]}
      icon={icon}
      title={label}
      eventHandlers={{ click: zoomIn, keydown: onEnterOrSpace(zoomInFromKeyboard) }}
    />
  );
}

export interface MapMarkersProps {
  rooms: PinRoom[];
  clusters: Cluster[];
  /** The zoom the clusters were grouped at, which decides the cell a click zooms into. */
  clusterZoom: number;
  pinAnchor: PinAnchor | null;
  onRoomClick: (id: string) => void;
}

// Rooms store a wrapped longitude, but the map repeats the world sideways. Each marker is drawn on
// the copy nearest the view's centre, recomputed after every move. At low zoom several copies are
// on screen at once, so the room just created stays on the copy that was clicked until the user
// drags or zooms. Not on any move: raising the mobile sheet moves the map too.
export function MapMarkers({ rooms, clusters, clusterZoom, pinAnchor, onRoomClick }: MapMarkersProps) {
  const map = useMap();
  const [centerLng, setCenterLng] = useState(() => map.getCenter().lng);
  const [releasedAnchor, setReleasedAnchor] = useState<PinAnchor | null>(null);
  useMapEvents({
    moveend: () => setCenterLng(map.getCenter().lng),
    dragstart: () => setReleasedAnchor(pinAnchor),
    zoomstart: () => setReleasedAnchor(pinAnchor),
  });
  const anchor = pinAnchor !== releasedAnchor ? pinAnchor : null;

  return (
    <>
      {clusters.map((cluster) => (
        <ClusterMarker
          key={`${cluster.lat},${cluster.lng}`}
          cluster={cluster}
          zoom={clusterZoom}
          centerLng={centerLng}
        />
      ))}
      {rooms.map((room) => (
        <Marker
          key={room.id}
          position={[room.lat, nearestWorldCopy(room.lng, room.id === anchor?.roomId ? anchor.lng : centerLng)]}
          icon={pinIcon}
          title={room.title}
          alt={room.title}
          eventHandlers={{
            click: () => onRoomClick(room.id),
            keydown: onEnterOrSpace(() => onRoomClick(room.id)),
          }}
        />
      ))}
    </>
  );
}
