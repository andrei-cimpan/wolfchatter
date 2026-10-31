"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer } from "react-leaflet";
import { INITIAL_VIEW, tileConfig } from "@/lib/map-config";

export default function LeafletMap() {
  return (
    <MapContainer center={INITIAL_VIEW.center} zoom={INITIAL_VIEW.zoom} className="h-full w-full">
      <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} />
    </MapContainer>
  );
}
