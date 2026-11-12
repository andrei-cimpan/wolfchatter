"use client";

import { Suspense, useEffect, useRef } from "react";
import { useCreateRoom } from "@/hooks/useCreateRoom";
import { useDraft } from "@/hooks/useDraft";
import { currentSelectedRoomId, selectRoom } from "@/hooks/useSelectedRoom";
import { MapView } from "./MapView";
import { RoomPanel, RoomPanelFallback } from "./RoomPanel";

/**
 * Connects the draft pin (`useDraft`, whose transitions live in `draftReducer`) to room creation
 * (`useCreateRoom`), which both the map (clicks, pins) and the panel (form, errors) show.
 */
export function ChatShell() {
  const { draft, pinAnchor, start, created, end } = useDraft();
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const creation = useCreateRoom(
    (room, clickedLng, userMovedOn) => created(room.id, clickedLng, userMovedOn),
    // Its error stays behind unseen, since only a draft shows one, and the next draft clears it.
    end,
  );

  function startDraft(lat: number, lng: number) {
    // One room at a time: the form being sent belongs to the draft where it is.
    if (creation.isSending()) return;
    start(lat, lng, currentSelectedRoomId() !== null);
    creation.clearResult();
    selectRoom(null);
  }

  function discardDraft() {
    if (creation.isSending()) return;
    end();
    creation.clearResult();
  }

  // The button that had the focus is gone, and focus on a removed element falls back to the page's
  // start. The map container is focusable (Leaflet's keyboard panning), and the next step is there.
  function discardFromPanel() {
    if (creation.isSending()) return;
    discardDraft();
    mapAreaRef.current?.querySelector<HTMLElement>(".leaflet-container")?.focus({ preventScroll: true });
  }

  function pickRoom(id: string) {
    end();
    creation.clearResult();
    creation.pick(id);
  }

  // Back or Forward ends a draft, whose form is gone by then. Left in place, it would come back on any
  // entry with no room open, and saving there would overwrite that entry. No dependency list on
  // purpose: re-registering after every render keeps the listener on this render's `creation`.
  useEffect(() => {
    function endDraft() {
      if (creation.isSending()) creation.abandonSend();
      else discardDraft();
    }
    window.addEventListener("popstate", endDraft);
    return () => window.removeEventListener("popstate", endDraft);
  });

  return (
    <main className="flex h-dvh flex-col overflow-hidden short-wide:has-[[data-raised]]:flex-row md:relative md:block">
      <h1 className="sr-only">Wolfchatter</h1>
      {/* `isolate` keeps Leaflet's high z-index panes and controls from covering the panel. */}
      <div ref={mapAreaRef} className="relative isolate min-h-0 min-w-0 flex-1 md:absolute md:inset-0">
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
          onDiscardDraft={discardFromPanel}
          onDraftSaved={end}
        />
      </Suspense>
    </main>
  );
}
