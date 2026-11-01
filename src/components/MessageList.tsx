"use client";

import { useEffect, useLayoutEffect, useRef, type UIEvent } from "react";
import { useMessages } from "@/hooks/useMessages";
import { useRoomStream } from "@/hooks/useRoomStream";
import { formatMessageTime, isNearBottom } from "@/lib/messages";
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

interface MessageListProps {
  roomId: string;
  /** How many posts this form has sent; each one brings the newest message into view. */
  sentCount: number;
}

/** Scrolls inside the card or sheet, so the form below it stays in view. Mount one per room. */
export function MessageList({ roomId, sentCount }: MessageListProps) {
  const query = useMessages(roomId);
  useRoomStream(roomId);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Recorded while scrolling: by the time an effect runs, the new message has already grown the
  // list, so measuring there would take a reader at the bottom for one who has scrolled up.
  const followingRef = useRef(true);
  const measuredSizeRef = useRef({ width: 0, height: 0 });
  const newestId = query.data?.at(-1)?.id;

  // Shows the newest message when the room opens and when one is added, unless the reader has
  // scrolled up to older ones.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && newestId !== undefined && followingRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [newestId]);

  // The reader's own post always comes into view, or it would land out of sight. It may render
  // before or after this count changes (the stream can deliver it first), so this also makes the
  // effect above follow it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || sentCount === 0) return;
    followingRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
  }, [sentCount]);

  // A narrower list rewraps its text and a shorter one shows less, both of which leave the end out
  // of view with nothing having been added.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      measuredSizeRef.current = { width: scroller.clientWidth, height: scroller.clientHeight };
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    const measured = measuredSizeRef.current;
    // Rewrapping moves scrollTop, and this event can fire before the observer above has run. That
    // was the layout, not the reader, so it must not count as scrolling up.
    if (scroller.clientWidth !== measured.width || scroller.clientHeight !== measured.height) return;
    followingRef.current = isNearBottom(scroller);
  }

  return (
    <div ref={scrollerRef} onScroll={handleScroll} className="mt-4 flex-auto overflow-y-auto">
      <MessageListBody query={query} />
    </div>
  );
}
