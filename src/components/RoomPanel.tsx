"use client";

import { useState, type ReactNode } from "react";
import { createRoomErrorMessage } from "@/hooks/useCreateRoom";
import { useHydrated } from "@/hooks/useHydrated";
import { useRoom } from "@/hooks/useRoom";
import { selectRoom, useSelectedRoomId } from "@/hooks/useSelectedRoom";
import { MessageForm } from "./MessageForm";
import { MessageList } from "./MessageList";

const EMPTY_STATE = "Click on the map to start a chat";

// Narrow screens: a banner in the page flow below the map, so it never hides the map's
// attribution, raised to half the screen once a room is open. From md up: a card floating over
// the map's top-right corner, as in the mockups.
function PanelFrame({ raised, busy = false, children }: { raised: boolean; busy?: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Chat"
      aria-busy={busy || undefined}
      className={`flex flex-col rounded-t-2xl border-t border-foreground/15 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.1)] md:absolute md:top-4 md:right-4 md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[380px] md:overflow-hidden md:rounded-md md:border md:border-foreground/30 md:pb-4 md:shadow-md ${raised ? "h-[50dvh]" : ""}`}
    >
      {children}
    </aside>
  );
}

/**
 * Shown while the search params are not known yet (the prerendered HTML). It may be a `?room` link,
 * so it must not say "click the map"; an empty line keeps the banner its usual height meanwhile.
 */
export function RoomPanelFallback() {
  return (
    <PanelFrame raised={false} busy>
      <p aria-hidden>{"\u00a0"}</p>
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

interface RoomContentProps {
  roomId: string;
  author: string;
  onAuthorChange: (author: string) => void;
}

function RoomContent({ roomId, author, onAuthorChange }: RoomContentProps) {
  const { data: room, isPending, isError } = useRoom(roomId);
  const hydrated = useHydrated();
  if (isPending || !hydrated) return <p role="status">Loading chatroom…</p>;
  if (isError) return <p role="alert">Couldn&apos;t load this chatroom. Please try again.</p>;
  if (room === null) return <p>This chatroom doesn&apos;t exist.</p>;
  return (
    <>
      <h2 className="text-center font-medium">{room.title}</h2>
      <MessageList roomId={room.id} />
      <MessageForm roomId={room.id} author={author} onAuthorChange={onAuthorChange} />
    </>
  );
}

interface RoomPanelProps {
  creating: boolean;
  creationError: Error | null;
  /** `?room` when the failed click happened; the error is hidden once the selection moves on. */
  creationErrorSelection: string | null;
}

export function RoomPanel({ creating, creationError, creationErrorSelection }: RoomPanelProps) {
  const roomId = useSelectedRoomId();
  const visibleError = creationErrorSelection === roomId ? creationError : null;
  const [author, setAuthor] = useState("");
  return (
    <PanelFrame raised={roomId !== null}>
      {roomId !== null && <SheetHeader />}
      {creating && (
        <p role="status" className="mb-2 text-sm text-foreground/60">
          Creating a chatroom…
        </p>
      )}
      {visibleError && (
        <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-400">
          {createRoomErrorMessage(visibleError)}
        </p>
      )}
      {roomId === null ? <p>{EMPTY_STATE}</p> : (
        // Keyed so each room mounts its own message log, which then does not read out the history
        // it opens with, and its own form, so a half-written message stays with its room.
        <RoomContent key={roomId} roomId={roomId} author={author} onAuthorChange={setAuthor} />
      )}
    </PanelFrame>
  );
}
