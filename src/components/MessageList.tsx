"use client";

import { useLayoutEffect, useRef } from "react";
import { useMessages } from "@/hooks/useMessages";
import { formatMessageTime } from "@/lib/messages";
import type { Message } from "@/lib/types";

/** The messages, oldest first: author and body, the date right-aligned below, then a divider. */
export function MessageItems({ messages }: { messages: readonly Message[] }) {
  return (
    <ol className="flex flex-col">
      {messages.map((message) => (
        <li key={message.id} className="border-b border-foreground/15 py-2">
          <p className="break-words whitespace-pre-wrap">
            <span className="mr-2 text-foreground/70">{message.author}:</span>
            <span className="font-medium">{message.body}</span>
          </p>
          <time dateTime={message.createdAt} className="block text-right text-xs text-foreground/60">
            {formatMessageTime(message.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

type MessagesQuery = ReturnType<typeof useMessages>;

// Only messages go in the log, which screen readers announce as it grows: status text there would
// be read out, and so would a whole history arriving in a log already on screen.
function MessageListBody({ query }: { query: MessagesQuery }) {
  const { data: messages, isPending, isError, refetch } = query;
  if (isPending) return <p role="status" className="text-sm text-foreground/60">Loading messages…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm">
        Couldn&apos;t load messages.{" "}
        <button type="button" onClick={() => void refetch()} className="underline">
          Try again
        </button>
      </p>
    );
  }
  return (
    <>
      {messages.length === 0 && <p className="text-center text-sm text-foreground/60">No messages yet</p>}
      <div role="log" aria-label="Messages">
        <MessageItems messages={messages} />
      </div>
    </>
  );
}

/** Scrolls inside the card or sheet, so the form below it stays in view. Mount one per room. */
export function MessageList({ roomId }: { roomId: string }) {
  const query = useMessages(roomId);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const newestId = query.data?.at(-1)?.id;

  // Shows the newest message when the room opens and when one is added. The raised sheet's list
  // fits only a message or two, so a new post would otherwise land out of sight. T5.2 refines this
  // for live messages, which should not pull a reader away from older ones.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && newestId !== undefined) scroller.scrollTop = scroller.scrollHeight;
  }, [newestId]);

  return (
    <div ref={scrollerRef} className="mt-4 flex-auto overflow-y-auto">
      <MessageListBody query={query} />
    </div>
  );
}
