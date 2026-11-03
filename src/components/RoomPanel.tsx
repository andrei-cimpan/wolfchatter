"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createRoomErrorMessage } from "@/hooks/useCreateRoom";
import { useHydrated } from "@/hooks/useHydrated";
import { useRoom } from "@/hooks/useRoom";
import { selectRoom, useSelectedRoomId } from "@/hooks/useSelectedRoom";
import { readSavedUsername, saveUsername } from "@/lib/saved-username";
import { MessageForm, RoomMessageForm } from "./MessageForm";
import { MessageList } from "./MessageList";

const EMPTY_STATE = "Click on the map to start a chat";
const DRAFT_NOTE = "Send the first message to create this chatroom. Until then, nobody else can see it.";

/** A pin dropped on the map but not saved: nothing exists on the server until its first message. */
export type DraftPin = {
  id: string;
  lat: number;
  lng: number;
  /** See DraftToSend. */
  openedOverRoom: boolean;
  /** The room it became, until the panel has switched to that room. */
  savedAs?: string;
};

// The form and headers take about 237 px, so 20rem leaves the list at least one whole message. The
// cap leaves the map's zoom buttons (102 px) and attribution on a very short screen; the panel scrolls.
const RAISED_SHEET = "h-[min(max(50dvh,20rem),calc(100dvh-7rem))]";
// Half the screen is too short for the chat here, and a taller sheet would leave no map, so the
// half goes beside the map. The map shrinks as it does for the sheet, keeping its attribution.
const RAISED_BESIDE_MAP =
  "short-wide:h-auto short-wide:w-1/2 short-wide:shrink-0 short-wide:rounded-t-none short-wide:rounded-l-2xl short-wide:border-t-0 short-wide:border-l short-wide:pr-[max(1rem,env(safe-area-inset-right))] short-wide:shadow-[-4px_0_12px_rgb(0_0_0/0.1)]";

// Narrow screens: a banner in the page flow below the map, so it never hides the map's
// attribution, raised to a sheet or set beside the map once a room is open. From md up: a card
// floating over the map's top-right corner, as in the mockups. It scrolls when even the form does
// not fit, such as in a very short window or at high browser zoom, so Submit can always be reached.
// `relative` keeps the form's absolutely positioned sr-only labels inside that scroll, or they
// stretch the page.
function PanelFrame({ raised, busy = false, children }: { raised: boolean; busy?: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Chat"
      aria-busy={busy || undefined}
      data-raised={raised || undefined}
      className={`relative flex flex-col overflow-y-auto rounded-t-2xl border-t border-foreground/15 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.1)] md:absolute md:top-4 md:right-[max(1rem,env(safe-area-inset-right))] md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[380px] md:rounded-md md:border md:border-foreground/30 md:pb-4 md:shadow-md ${raised ? `${RAISED_SHEET} ${RAISED_BESIDE_MAP}` : ""}`}
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

function SheetHeader({
  onClose,
  closeUnavailable,
  leading,
}: {
  onClose: () => void;
  closeUnavailable: boolean;
  leading?: ReactNode;
}) {
  return (
    <div className="relative mb-2 flex h-11 shrink-0 items-center justify-between md:hidden">
      {leading ?? <span />}
      <span aria-hidden className="absolute left-1/2 top-0 h-1 w-10 -translate-x-1/2 rounded-full bg-foreground/20 short-wide:hidden" />
      <button
        type="button"
        aria-label="Close chat"
        aria-disabled={closeUnavailable || undefined}
        onClick={onClose}
        className="flex size-11 items-center justify-center rounded-full text-2xl leading-none not-aria-disabled:hover:bg-foreground/10 aria-disabled:opacity-60"
      >
        ×
      </button>
    </div>
  );
}

// While the first message is on its way the room is about to exist, so there is nothing to discard.
// aria-disabled, as for Submit: a disabled button would lose keyboard focus, and the send may fail.
function DiscardButton({
  onClick,
  unavailable,
  className = "",
}: {
  onClick: () => void;
  unavailable: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      onClick={onClick}
      className={`h-11 rounded px-2 text-sm underline not-aria-disabled:hover:bg-foreground/10 aria-disabled:opacity-60 ${className}`}
    >
      Discard
    </button>
  );
}

interface DraftContentProps {
  author: string;
  onAuthorChange: (author: string) => void;
  send: (author: string, body: string, onSent: () => void) => void;
  clearError: () => void;
  isPending: boolean;
  error: Error | null;
  onDiscard: () => void;
}

function DraftContent({ author, onAuthorChange, send, clearError, isPending, error, onDiscard }: DraftContentProps) {
  return (
    <>
      <h2 className="text-center font-medium">New chatroom</h2>
      <p role="status" className="mt-4 flex-auto text-center text-sm text-foreground/70">
        {DRAFT_NOTE}
      </p>
      <MessageForm
        author={author}
        onAuthorChange={onAuthorChange}
        send={send}
        clearError={clearError}
        isPending={isPending}
        errorMessage={error ? createRoomErrorMessage(error) : null}
      />
      {/* The sheet has this in its header instead, where it costs no height. */}
      <DiscardButton onClick={onDiscard} unavailable={isPending} className="mt-2 hidden self-start md:block" />
    </>
  );
}

interface RoomContentProps {
  roomId: string;
  author: string;
  onAuthorChange: (author: string) => void;
  autoFocusBody: boolean;
}

function RoomContent({ roomId, author, onAuthorChange, autoFocusBody }: RoomContentProps) {
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
      <RoomMessageForm
        roomId={room.id}
        author={author}
        onAuthorChange={onAuthorChange}
        onSent={() => setSentCount((count) => count + 1)}
        autoFocusBody={autoFocusBody}
      />
    </>
  );
}

interface RoomPanelProps {
  draft: DraftPin | null;
  creating: boolean;
  creationError: Error | null;
  createdRoomId: string | null;
  onSendDraft: (draft: DraftPin, author: string, body: string, onSent: () => void) => void;
  onClearCreationError: () => void;
  onDiscardDraft: () => void;
  onDraftSaved: () => void;
}

export function RoomPanel({
  draft,
  creating,
  creationError,
  createdRoomId,
  onSendDraft,
  onClearCreationError,
  onDiscardDraft,
  onDraftSaved,
}: RoomPanelProps) {
  const roomId = useSelectedRoomId();
  // Until `?room` catches up: a draft starts in the render before an open room closes.
  const openDraft = roomId === null ? draft : null;
  const savedAs = draft?.savedAs ?? null;
  useEffect(() => {
    if (savedAs !== null && savedAs === roomId) onDraftSaved();
  }, [savedAs, roomId, onDraftSaved]);
  // The server starts empty and the browser with the saved name, which cannot cause a hydration
  // mismatch: RoomContent renders the form only once hydrated.
  const [author, setAuthor] = useState(readSavedUsername);
  function changeAuthor(next: string) {
    setAuthor(next);
    saveUsername(next);
  }
  function close() {
    selectRoom(null);
    onDiscardDraft();
  }
  const raised = roomId !== null || openDraft !== null;
  return (
    <PanelFrame raised={raised}>
      {raised && (
        <SheetHeader
          onClose={close}
          closeUnavailable={openDraft !== null && creating}
          leading={openDraft && <DiscardButton onClick={onDiscardDraft} unavailable={creating} />}
        />
      )}
      {creating && (
        <p role="status" className="mb-2 text-sm text-foreground/60">
          Creating a chatroom…
        </p>
      )}
      {roomId !== null ? (
        // Keyed so each room mounts its own message log, which then does not read out the history
        // it opens with, and its own form, so a half-written message stays with its room.
        <RoomContent
          key={roomId}
          roomId={roomId}
          author={author}
          onAuthorChange={changeAuthor}
          autoFocusBody={roomId === createdRoomId}
        />
      ) : openDraft ? (
        // Not keyed by the draft: moving the pin keeps what has been typed, since the place was
        // probably just misjudged.
        <DraftContent
          author={author}
          onAuthorChange={changeAuthor}
          send={(sentAuthor, body, onSent) => onSendDraft(openDraft, sentAuthor, body, onSent)}
          clearError={onClearCreationError}
          isPending={creating}
          error={creationError}
          onDiscard={onDiscardDraft}
        />
      ) : (
        <p>{EMPTY_STATE}</p>
      )}
    </PanelFrame>
  );
}
