"use client";

import { useRef, useState, type FormEvent } from "react";
import { messageInputError, postMessageErrorMessage, usePostMessage } from "@/hooks/useMessages";
import { AUTHOR_MAX, BODY_MAX } from "@/lib/limits";
import { VisibleAlert } from "./VisibleAlert";

const FIELD = "h-11 min-w-0 rounded border border-foreground/30 bg-background px-3";

interface MessageFieldsProps {
  /** Owned by the panel, so the username carries over when the user switches rooms. */
  author: string;
  onAuthorChange: (author: string) => void;
  onSent?: () => void;
  /** For the room just created, so the writer can carry on without clicking back in. */
  autoFocusBody?: boolean;
}

interface MessageFormProps extends MessageFieldsProps {
  /** Sends unless one is already on its way; `onSent` runs only while still mounted. */
  send: (author: string, body: string, onSent: () => void) => void;
  clearError: () => void;
  isPending: boolean;
  /** What went wrong with the last send, ready to show. */
  errorMessage: string | null;
}

/** The form of a room that exists: each message is posted to it. */
export function RoomMessageForm({ roomId, ...fields }: MessageFieldsProps & { roomId: string }) {
  const { send, clearError, isPending, error } = usePostMessage(roomId);
  return (
    <MessageForm
      {...fields}
      send={send}
      clearError={clearError}
      isPending={isPending}
      errorMessage={error ? postMessageErrorMessage(error) : null}
    />
  );
}

// maxLength counts UTF-16 units and the API counts code points, so the fields are at most as
// lenient as the API: an emoji-heavy text can be cut short, but never rejected as too long.
export function MessageForm({
  author,
  onAuthorChange,
  onSent,
  autoFocusBody = false,
  send,
  clearError,
  isPending,
  errorMessage,
}: MessageFormProps) {
  const [body, setBody] = useState("");
  // Worked out from the current input, so the hint goes away as soon as the input is fixed.
  const inputError = messageInputError(author, body);
  const [triedInvalid, setTriedInvalid] = useState(false);
  // Once fixed, the next hint waits for another attempt: clearing the field to retype is not one.
  if (triedInvalid && inputError === null) setTriedInvalid(false);
  const bodyRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTriedInvalid(inputError !== null);
    if (inputError) {
      // Otherwise it would come back when the hint clears, about a message that was not sent.
      clearError();
      return;
    }
    send(author, body, () => {
      setBody("");
      bodyRef.current?.focus();
      onSent?.();
    });
  }

  const shownError = (triedInvalid ? inputError : null) ?? errorMessage;
  return (
    <form onSubmit={handleSubmit} className="mt-4 flex shrink-0 flex-col gap-2">
      <label htmlFor="message-author" className="sr-only">
        Username
      </label>
      <input
        id="message-author"
        value={author}
        onChange={(event) => onAuthorChange(event.target.value)}
        placeholder="Your username"
        maxLength={AUTHOR_MAX}
        autoComplete="nickname"
        required
        className={FIELD}
      />
      {/* Wraps in a very narrow panel, where Submit would otherwise squeeze the field to nothing. */}
      <div className="flex flex-wrap gap-2">
        <label htmlFor="message-body" className="sr-only">
          Message
        </label>
        <input
          id="message-body"
          ref={bodyRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message"
          maxLength={BODY_MAX}
          autoComplete="off"
          autoFocus={autoFocusBody}
          required
          className={`${FIELD} flex-[1_1_8rem]`}
        />
        {/* aria-disabled, not disabled: a disabled button loses keyboard focus when a post starts,
            and could not explain what is missing. handleSubmit and the send ref do the blocking. */}
        <button
          type="submit"
          aria-disabled={isPending || inputError !== null || undefined}
          className="ml-auto h-11 shrink-0 rounded border border-foreground/30 px-4 font-medium not-aria-disabled:hover:bg-foreground/10 aria-disabled:opacity-60"
        >
          Submit
        </button>
      </div>
      {shownError && <VisibleAlert message={shownError} className="text-sm text-red-700 dark:text-red-400" />}
    </form>
  );
}
