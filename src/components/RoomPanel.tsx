"use client";

import { useState, type ReactNode } from "react";
import { createRoomErrorMessage } from "@/hooks/useCreateRoom";
import { useHydrated } from "@/hooks/useHydrated";
import { useRoom } from "@/hooks/useRoom";
import { selectRoom, useSelectedRoomId } from "@/hooks/useSelectedRoom";
import { readSavedUsername, saveUsername } from "@/lib/saved-username";
import { MessageForm } from "./MessageForm";
import { MessageList } from "./MessageList";

const EMPTY_STATE = "Click on the map to start a chat";

// The form and headers take about 237 px, so 20rem leaves the list at least one whole message.
const RAISED_SHEET = "h-[max(50dvh,20rem)]";
// Half the screen is too short for the chat here, and a taller sheet would leave no map, so the
// half goes beside the map. The map shrinks as it does for the sheet, keeping its attribution.
const RAISED_BESIDE_MAP =
  "short-wide:h-auto short-wide:w-1/2 short-wide:shrink-0 short-wide:rounded-t-none short-wide:rounded-l-2xl short-wide:border-t-0 short-wide:border-l short-wide:pr-[max(1rem,env(safe-area-inset-right))] short-wide:shadow-[-4px_0_12px_rgb(0_0_0/0.1)]";

// Narrow screens: a banner in the page flow below the map, so it never hides the map's
// attribution, raised to half the screen once a room is open. From md up: a card floating over
// the map's top-right corner, as in the mockups. It scrolls when even the form does not fit, such
// as in a very short window or at high browser zoom, so Submit can always be reached. `relative`
// keeps the form's absolutely positioned sr-only labels inside that scroll, or they stretch the page.
function PanelFrame({ raised, busy = false, children }: { raised: boolean; busy?: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Chat"
      aria-busy={busy || undefined}
      data-raised={raised || undefined}
      className={`relative flex flex-col overflow-y-auto rounded-t-2xl border-t border-foreground/15 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.1)] md:absolute md:top-4 md:right-4 md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[380px] md:rounded-md md:border md:border-foreground/30 md:pb-4 md:shadow-md ${raised ? `${RAISED_SHEET} ${RAISED_BESIDE_MAP}` : ""}`}
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
      <span aria-hidden className="absolute left-1/2 top-0 h-1 w-10 -translate-x-1/2 rounded-full bg-foreground/20 short-wide:hidden" />
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
  const [sentCount, setSentCount] = useState(0);
  if (isPending || !hydrated) return <p role="status">Loading chatroom…</p>;
  if (isError) return <p role="alert">Couldn&apos;t load this chatroom. Please try again.</p>;
  if (room === null) return <p>This chatroom doesn&apos;t exist.</p>;
  return (
    <>
      <h2 className="text-center font-medium">{room.title}</h2>
      <MessageList roomId={room.id} sentCount={sentCount} />
      <MessageForm
        roomId={room.id}
        author={author}
        onAuthorChange={onAuthorChange}
        onSent={() => setSentCount((count) => count + 1)}
      />
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
  // The server starts empty and the browser with the saved name, which cannot cause a hydration
  // mismatch: RoomContent renders the form only once hydrated.
  const [author, setAuthor] = useState(readSavedUsername);
  function changeAuthor(next: string) {
    setAuthor(next);
    saveUsername(next);
  }
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
        <RoomContent key={roomId} roomId={roomId} author={author} onAuthorChange={changeAuthor} />
      )}
    </PanelFrame>
  );
}
