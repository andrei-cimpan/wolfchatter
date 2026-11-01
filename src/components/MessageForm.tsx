"use client";

import { useRef, useState, type FormEvent } from "react";
import { messageInputError, postMessageErrorMessage, usePostMessage } from "@/hooks/useMessages";
import { AUTHOR_MAX, BODY_MAX } from "@/lib/limits";

const FIELD = "h-11 min-w-0 rounded border border-foreground/30 bg-background px-3";

interface MessageFormProps {
  roomId: string;
  /** Owned by the panel, so the username carries over when the user switches rooms. */
  author: string;
  onAuthorChange: (author: string) => void;
  onSent: () => void;
}

// maxLength counts UTF-16 units and the API counts code points, so the fields are at most as
// lenient as the API: an emoji-heavy text can be cut short, but never rejected as too long.
export function MessageForm({ roomId, author, onAuthorChange, onSent }: MessageFormProps) {
  const [body, setBody] = useState("");
  // Worked out from the current input, so the hint goes away as soon as the input is fixed.
  const inputError = messageInputError(author, body);
  const [triedInvalid, setTriedInvalid] = useState(false);
  // Once fixed, the next hint waits for another attempt: clearing the field to retype is not one.
  if (triedInvalid && inputError === null) setTriedInvalid(false);
  const bodyRef = useRef<HTMLInputElement>(null);
  const { send, clearError, isPending, error } = usePostMessage(roomId);

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
      onSent();
    });
  }

  const shownError = (triedInvalid ? inputError : null) ?? (error ? postMessageErrorMessage(error) : null);
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
      <div className="flex gap-2">
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
          required
          className={`${FIELD} flex-1`}
        />
        {/* aria-disabled, not disabled: a disabled button loses keyboard focus when a post starts,
            and could not explain what is missing. handleSubmit and the send ref do the blocking. */}
        <button
          type="submit"
          aria-disabled={isPending || inputError !== null || undefined}
          className="h-11 shrink-0 rounded border border-foreground/30 px-4 font-medium not-aria-disabled:hover:bg-foreground/10 aria-disabled:opacity-60"
        >
          Submit
        </button>
      </div>
      {shownError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {shownError}
        </p>
      )}
    </form>
  );
}
