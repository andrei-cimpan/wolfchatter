"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeletingRoom } from "@/hooks/useDeleteRoom";
import { useFormAcrossSignOut } from "@/hooks/useFormAcrossSignOut";
import { useHydrated } from "@/hooks/useHydrated";
import { useRoom } from "@/hooks/useRoom";
import { selectRoom, useSelectedRoomId } from "@/hooks/useSelectedRoom";
import type { Draft } from "@/lib/draft";
import { createRoomErrorMessage, isSignedOutError } from "@/lib/message-input";
import { DeleteRoomButton } from "./DeleteRoomButton";
import { MessageForm, RoomMessageForm } from "./MessageForm";
import { MessageList } from "./MessageList";
import { PostingAs } from "./PostingAs";
import { SignInPrompt } from "./SignInPrompt";

const EMPTY_STATE = "Click on the map to start a chat";
const DRAFT_NOTE = "Send the first message to create this chatroom. Until then, nobody else can see it.";
const SIGNED_OUT_DRAFT_NOTE = "Sign in to create a chatroom here. Your pin stays where you dropped it.";
const CLOSED_NOTE = "The owner has closed the room";

// Narrow screens: a sheet rising from the bottom edge, clear of the phone's home indicator.
const PANEL_SHEET =
  "rounded-t-2xl border-t border-foreground/15 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.1)]";
// From md up: a card over the map's top-right corner, clear of a notch, never taller than the window.
const PANEL_CARD =
  "md:absolute md:top-4 md:right-[max(1rem,env(safe-area-inset-right))] md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[380px] md:rounded-md md:border md:border-foreground/30 md:pb-4 md:shadow-md";
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
      className={`relative flex flex-col overflow-y-auto ${PANEL_SHEET} ${PANEL_CARD} ${raised ? `${RAISED_SHEET} ${RAISED_BESIDE_MAP}` : ""}`}
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
      {/* A wrapper even when empty, which a component that renders nothing would not leave. */}
      <div className="flex">{leading}</div>
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
  draft: Draft;
  send: (body: string, onSent: () => void) => void;
  clearError: () => void;
  isPending: boolean;
  error: Error | null;
  onDiscard: () => void;
}

function DraftContent({ draft, send, clearError, isPending, error, onDiscard }: DraftContentProps) {
  const user = useCurrentUser();
  const form = useFormAcrossSignOut(user.status);
  return (
    <>
      <h2 className="text-center font-medium">New chatroom</h2>
      {/* Nothing until /api/me answers, so neither the form nor the prompt flashes. */}
      {user.status !== "loading" && (
        <p role="status" className="mt-4 flex-auto text-center text-sm text-foreground/70">
          {form.showForm ? DRAFT_NOTE : SIGNED_OUT_DRAFT_NOTE}
        </p>
      )}
      {user.status === "signedOut" && !form.showForm && (
        <SignInPrompt label="Sign in with Google" draft={{ lat: draft.lat, lng: draft.lng }} />
      )}
      {form.showForm && (
        <>
          {user.name !== null && <PostingAs name={user.name} />}
          <MessageForm
            onHasTextChange={form.onHasTextChange}
            sessionEnded={form.sessionEnded}
            send={send}
            clearError={clearError}
            isPending={isPending}
            errorMessage={error ? createRoomErrorMessage(error) : null}
            signedOut={error ? isSignedOutError(error) : false}
            signInDraft={{ lat: draft.lat, lng: draft.lng }}
          />
        </>
      )}
      {/* The sheet has this in its header instead, where it costs no height. */}
      <DiscardButton onClick={onDiscard} unavailable={isPending} className="mt-2 hidden self-start md:block" />
    </>
  );
}

interface RoomContentProps {
  roomId: string;
  autoFocusBody: boolean;
}

/** Where a room deleted while open ends up, for everyone but the creator, whose panel closes. */
function RoomClosed() {
  return (
    <>
      <p role="status">{CLOSED_NOTE}</p>
      <button type="button" onClick={() => selectRoom(null)} className="mt-2 h-11 self-start rounded px-2 underline hover:bg-foreground/10">
        Close
      </button>
    </>
  );
}

function RoomContent({ roomId, autoFocusBody }: RoomContentProps) {
  const { data: room, isPending, isError } = useRoom(roomId);
  const user = useCurrentUser();
  const form = useFormAcrossSignOut(user.status);
  const hydrated = useHydrated();
  const [sentCount, setSentCount] = useState(0);
  const deleting = useDeletingRoom(roomId);
  // A room that was here and now is not has been deleted while open, rather than never existing.
  const [seenRoom, setSeenRoom] = useState(false);
  if (room && !seenRoom) setSeenRoom(true);
  if (isPending || !hydrated) return <p role="status">Loading chatroom…</p>;
  if (isError) return <p role="alert">Couldn&apos;t load this chatroom. Please try again.</p>;
  if (room === null) {
    // The creator's own deletion closes the panel; its live echo may land a moment before.
    if (deleting) return null;
    return seenRoom ? <RoomClosed /> : <p>This chatroom doesn&apos;t exist.</p>;
  }
  return (
    <>
      {/* The sheet has the button in its header instead, where it costs no height or width. The
          negative margin keeps the card's title line its usual height around the 44 px target. */}
      <div className="flex shrink-0 items-center justify-center gap-2 md:has-[button]:justify-between">
        <h2 className="font-medium">{room.title}</h2>
        <DeleteRoomButton roomId={room.id} className="-my-2.5 hidden md:block" />
      </div>
      <MessageList roomId={room.id} sentCount={sentCount} />
      {/* Nothing until /api/me answers, so neither the form nor the prompt flashes. */}
      {user.status === "signedOut" && !form.showForm && <SignInPrompt label="Sign in with Google to post" />}
      {form.showForm && (
        <>
          {user.name !== null && <PostingAs name={user.name} />}
          <RoomMessageForm
            roomId={room.id}
            onHasTextChange={form.onHasTextChange}
            sessionEnded={form.sessionEnded}
            onSent={() => setSentCount((count) => count + 1)}
            autoFocusBody={autoFocusBody}
          />
        </>
      )}
    </>
  );
}

interface RoomPanelProps {
  draft: Draft | null;
  creating: boolean;
  creationError: Error | null;
  createdRoomId: string | null;
  onSendDraft: (draft: Draft, body: string, onSent: () => void) => void;
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
          leading={
            openDraft ? (
              <DiscardButton onClick={onDiscardDraft} unavailable={creating} />
            ) : (
              roomId !== null && <DeleteRoomButton key={roomId} roomId={roomId} />
            )
          }
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
        <RoomContent key={roomId} roomId={roomId} autoFocusBody={roomId === createdRoomId} />
      ) : openDraft ? (
        // Not keyed by the draft: moving the pin keeps what has been typed, since the place was
        // probably just misjudged.
        <DraftContent
          draft={openDraft}
          send={(body, onSent) => onSendDraft(openDraft, body, onSent)}
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
