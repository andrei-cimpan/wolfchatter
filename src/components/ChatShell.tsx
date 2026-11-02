"use client";

import { Suspense, useRef, useState } from "react";
import { useCreateRoom } from "@/hooks/useCreateRoom";
import { currentSelectedRoomId, selectRoom } from "@/hooks/useSelectedRoom";
import type { PinAnchor } from "./LeafletMap";
import { MapView } from "./MapView";
import { RoomPanel, RoomPanelFallback, type DraftPin } from "./RoomPanel";

/** Owns the draft pin and room creation, which both the map (clicks, pins) and the panel (form, errors) show. */
export function ChatShell() {
  // Where the newest pin was clicked, which may be a repeated copy of the world.
  const [pinAnchor, setPinAnchor] = useState<PinAnchor | null>(null);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const draftCount = useRef(0);
  const creation = useCreateRoom((room, clickedLng, userMovedOn) => {
    setPinAnchor({ roomId: room.id, lng: clickedLng });
    // Kept until the panel sees the new selection: clearing it now would drop the sheet for a frame,
    // because Next.js applies `?room` in a transition.
    setDraft((current) => (userMovedOn || !current ? null : { ...current, savedAs: room.id }));
  });

  function startDraft(lat: number, lng: number) {
    // One room at a time: the form being sent belongs to the draft where it is.
    if (creation.isSending()) return;
    draftCount.current += 1;
    const id = `draft-${draftCount.current}`;
    const roomWasOpen = currentSelectedRoomId() !== null;
    // Moving a draft adds no history entry, so it still owns the one it started with.
    setDraft((current) => ({ id, lat, lng, openedOverRoom: roomWasOpen || (current?.openedOverRoom ?? false) }));
    setPinAnchor({ roomId: id, lng });
    creation.clearResult();
    selectRoom(null);
  }

  function discardDraft() {
    if (creation.isSending()) return;
    setDraft(null);
    creation.clearResult();
  }

  function pickRoom(id: string) {
    setDraft(null);
    creation.clearResult();
    creation.pick(id);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden short-wide:has-[[data-raised]]:flex-row md:relative md:block">
      <h1 className="sr-only">Wolfchatter</h1>
      {/* `isolate` keeps Leaflet's high z-index panes and controls from covering the panel. */}
      <div className="relative isolate min-h-0 min-w-0 flex-1 md:absolute md:inset-0">
        <MapView
          pinAnchor={pinAnchor}
          draft={draft}
          onMapClick={startDraft}
          onDoubleClickUndo={discardDraft}
          onRoomClick={pickRoom}
        />
      </div>
      {/* useSearchParams needs a Suspense boundary so the rest of the page can prerender. */}
      <Suspense fallback={<RoomPanelFallback />}>
        <RoomPanel
          draft={draft}
          creating={creation.isPending}
          creationError={creation.error}
          createdRoomId={creation.createdRoomId}
          onSendDraft={(current, author, body, onSent) => creation.send(current, author, body, onSent)}
          onClearCreationError={creation.clearResult}
          onDiscardDraft={discardDraft}
          onDraftSaved={() => setDraft(null)}
        />
      </Suspense>
    </main>
  );
}
