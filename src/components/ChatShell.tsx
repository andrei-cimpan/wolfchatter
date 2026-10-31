"use client";

import { Suspense, useState } from "react";
import { useCreateRoom } from "@/hooks/useCreateRoom";
import type { PinAnchor } from "./LeafletMap";
import { MapView } from "./MapView";
import { RoomPanel, RoomPanelFallback } from "./RoomPanel";

/** Owns room creation, which both the map (clicks, pins) and the panel (progress, errors) show. */
export function ChatShell() {
  // Where the newest room was clicked, which may be a repeated copy of the world.
  const [pinAnchor, setPinAnchor] = useState<PinAnchor | null>(null);
  const creation = useCreateRoom((room, clickedLng) => {
    setPinAnchor({ roomId: room.id, lng: clickedLng });
  });

  return (
    <main className="flex h-dvh flex-col overflow-hidden md:relative md:block">
      <h1 className="sr-only">Wolfchatter</h1>
      {/* `isolate` keeps Leaflet's high z-index panes and controls from covering the panel. */}
      <div className="relative isolate min-h-0 flex-1 md:absolute md:inset-0">
        <MapView
          pinAnchor={pinAnchor}
          onMapClick={creation.create}
          onRoomClick={creation.pick}
        />
      </div>
      {/* useSearchParams needs a Suspense boundary so the rest of the page can prerender. */}
      <Suspense fallback={<RoomPanelFallback />}>
        <RoomPanel
          creating={creation.isPending}
          creationError={creation.error}
          creationErrorSelection={creation.errorSelection}
        />
      </Suspense>
    </main>
  );
}
