"use client";

import type { ReactNode } from "react";
import { createRoomErrorMessage } from "@/hooks/useCreateRoom";
import { useHydrated } from "@/hooks/useHydrated";
import { useRoom } from "@/hooks/useRoom";
import { selectRoom, useSelectedRoomId } from "@/hooks/useSelectedRoom";

const EMPTY_STATE = "Click on the map to start a chat";

// Narrow screens: a banner in the page flow below the map, so it never hides the map's
// attribution, raised to half the screen once a room is open. From md up: a card floating over
// the map's top-right corner, as in the mockups.
function PanelFrame({ raised, children }: { raised: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Chat"
      className={`flex flex-col rounded-t-2xl border-t border-foreground/15 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.1)] md:absolute md:top-4 md:right-4 md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[380px] md:overflow-hidden md:rounded-md md:border md:border-foreground/30 md:pb-4 md:shadow-md ${raised ? "h-[50dvh]" : ""}`}
    >
      {children}
    </aside>
  );
}

/** Shown while the search params are not known yet (prerendered HTML). */
export function RoomPanelFallback() {
  return (
    <PanelFrame raised={false}>
      <p>{EMPTY_STATE}</p>
    </PanelFrame>
  );
}

function SheetHeader() {
  return (
    <div className="relative mb-2 flex h-11 items-center justify-end md:hidden">
      <span aria-hidden className="absolute left-1/2 top-0 h-1 w-10 -translate-x-1/2 rounded-full bg-foreground/20" />
      <button
        type="button"
        aria-label="Close chat"
        onClick={() => selectRoom(null)}
        className="flex size-11 items-center justify-center rounded-full text-2xl leading-none hover:bg-foreground/10"
      >
        ×
      </button>
    </div>
  );
}

function RoomContent({ roomId }: { roomId: string }) {
  const { data: room, isPending, isError } = useRoom(roomId);
  const hydrated = useHydrated();
  if (isPending || !hydrated) return <p role="status">Loading chatroom…</p>;
  if (isError) return <p role="alert">Couldn&apos;t load this chatroom. Please try again.</p>;
  if (room === null) return <p>This chatroom doesn&apos;t exist.</p>;
  return (
    <>
      <h2 className="text-center font-medium">{room.title}</h2>
      <p className="mt-6 text-center text-sm text-foreground/60">No messages yet</p>
    </>
  );
}

export function RoomPanel({ creating, creationError }: { creating: boolean; creationError: Error | null }) {
  const roomId = useSelectedRoomId();
  return (
    <PanelFrame raised={roomId !== null}>
      {roomId !== null && <SheetHeader />}
      {creating && (
        <p role="status" className="mb-2 text-sm text-foreground/60">
          Creating a chatroom…
        </p>
      )}
      {creationError && (
        <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-400">
          {createRoomErrorMessage(creationError)}
        </p>
      )}
      {roomId === null ? <p>{EMPTY_STATE}</p> : <RoomContent roomId={roomId} />}
    </PanelFrame>
  );
}
