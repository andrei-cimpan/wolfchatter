"use client";

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

function MessageListBody({ roomId }: { roomId: string }) {
  const { data: messages, isPending, isError, refetch } = useMessages(roomId);
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
  if (messages.length === 0) return <p className="text-center text-sm text-foreground/60">No messages yet</p>;
  return <MessageItems messages={messages} />;
}

/** Scrolls inside the card or sheet, so the form below it stays in view. */
export function MessageList({ roomId }: { roomId: string }) {
  return (
    <div role="log" aria-label="Messages" className="mt-4 flex-auto overflow-y-auto">
      <MessageListBody roomId={roomId} />
    </div>
  );
}
