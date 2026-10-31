"use client";

import { Suspense, useRef, useState } from "react";
import { useCreateRoom } from "@/hooks/useCreateRoom";
import { selectRoom } from "@/hooks/useSelectedRoom";
import type { Room } from "@/lib/types";
import { MapView } from "./MapView";
import { RoomPanel, RoomPanelFallback } from "./RoomPanel";

/** Owns room creation, which both the map (clicks, pins) and the panel (progress, errors) show. */
export function ChatShell() {
  // Pins for rooms made in this tab; T3.3 replaces them with the rooms in the viewport.
  const [createdRooms, setCreatedRooms] = useState<Room[]>([]);
  const creation = useCreateRoom((room) => setCreatedRooms((rooms) => [...rooms, room]));

  // A ref, not `creation.isPending`: two clicks can land before React re-renders with the new state.
  const creatingRef = useRef(false);

  function handleMapClick(lat: number, lng: number) {
    // One room at a time: ignore clicks while the previous room is still being created.
    if (creatingRef.current) return;
    creatingRef.current = true;
    creation.mutate(
      { lat, lng },
      {
        onSettled: () => {
          creatingRef.current = false;
        },
      },
    );
  }

  function handleRoomClick(id: string) {
    creation.reset();
    selectRoom(id);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden md:relative md:block">
      <h1 className="sr-only">Wolfchatter</h1>
      {/* `isolate` keeps Leaflet's high z-index panes and controls from covering the panel. */}
      <div className="relative isolate min-h-0 flex-1 md:absolute md:inset-0">
        <MapView
          createdRooms={createdRooms}
          onMapClick={handleMapClick}
          onRoomClick={handleRoomClick}
        />
      </div>
      {/* useSearchParams needs a Suspense boundary so the rest of the page can prerender. */}
      <Suspense fallback={<RoomPanelFallback />}>
        <RoomPanel creating={creation.isPending} creationError={creation.error} />
      </Suspense>
    </main>
  );
}
