"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer } from "react-leaflet";
import { INITIAL_VIEW, tileConfigFromEnv } from "@/lib/map-config";

const tileConfig = tileConfigFromEnv();

export default function LeafletMap() {
  return (
    <MapContainer center={INITIAL_VIEW.center} zoom={INITIAL_VIEW.zoom} className="h-full w-full">
      <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} />
    </MapContainer>
  );
}
