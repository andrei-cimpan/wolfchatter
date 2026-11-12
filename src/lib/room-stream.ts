import { messageFromRow, type MessageRow } from "./message-row";
import { messageSchema } from "./schemas";
import { getBrowserSupabase } from "./supabase/browser-client";
import { subscribeToRoomMessages, type RoomChannelHandlers } from "./supabase/room-channel";
import type { Message } from "./types";

export const STREAM_RETRY_MIN_MS = 1000;
export const STREAM_RETRY_MAX_MS = 30_000;

export type RoomStreamHandlers = {
  /** Live messages are flowing: catch up on anything sent before. Runs on every (re)subscribe. */
  onReady(): void;
  onMessage(message: Message): void;
};

/** Subscribes to a room's new messages until the returned function is called. */
export type SubscribeToRoom = (roomId: string, handlers: RoomChannelHandlers) => () => void;

/** The part of `document` this module uses, so tests can pass a fake. */
export type PageVisibility = {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export type RoomStreamOptions = {
  subscribe?: SubscribeToRoom;
  /** For tests: picks where in its upper half each backoff wait falls. */
  random?: () => number;
  page?: PageVisibility;
};

/**
 * Keeps the room's Realtime subscription open until the returned function is called. A channel
 * that fails is dropped and a new one subscribed after 1 s, doubling to 30 s, with jitter, until one
 * is ready again; each `ready` runs `onReady`, which catches up on what was sent in between.
 *
 * A hidden tab holds no channel. Browsers throttle background tabs, which can starve the socket's
 * heartbeat, and a tab nobody looks at has no reason to receive messages; `ready` catches it up
 * when it returns.
 */
export function connectRoomStream(
  roomId: string,
  handlers: RoomStreamHandlers,
  {
    subscribe = (id, channelHandlers) => subscribeToRoomMessages(getBrowserSupabase(), id, channelHandlers),
    random = Math.random,
    page = typeof document === "undefined" ? undefined : document,
  }: RoomStreamOptions = {},
): () => void {
  let unsubscribe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = STREAM_RETRY_MIN_MS;

  function connect(): void {
    const current = subscribe(roomId, {
      onInsert: (row) => {
        const message = parseMessage(row);
        if (message?.roomId === roomId) handlers.onMessage(message);
      },
      onStatus: (status) => {
        if (unsubscribe !== current) return;
        if (status === "ready") {
          retryMs = STREAM_RETRY_MIN_MS;
          handlers.onReady();
          return;
        }
        current();
        unsubscribe = undefined;
        // Anywhere in the upper half of the wait, so clients dropped together do not return together.
        retryTimer = setTimeout(connect, retryMs * (0.5 + random() / 2));
        retryMs = Math.min(retryMs * 2, STREAM_RETRY_MAX_MS);
      },
    });
    unsubscribe = current;
  }

  function disconnect(): void {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  }

  function onVisibilityChange(): void {
    if (page?.hidden) {
      disconnect();
    } else if (!unsubscribe && retryTimer === undefined) {
      retryMs = STREAM_RETRY_MIN_MS;
      connect();
    }
  }

  page?.addEventListener("visibilitychange", onVisibilityChange);
  if (!page?.hidden) connect();
  return () => {
    page?.removeEventListener("visibilitychange", onVisibilityChange);
    disconnect();
  };
}

// Rows come straight from Postgres through Realtime; one that does not make a valid message is dropped.
function parseMessage(row: MessageRow): Message | null {
  try {
    const result = messageSchema.safeParse(messageFromRow(row));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
