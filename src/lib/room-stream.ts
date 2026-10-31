import { messageSchema } from "./schemas";
import type { Message } from "./types";

export const STREAM_RETRY_MIN_MS = 1000;
export const STREAM_RETRY_MAX_MS = 30_000;

// EventSource.CLOSED, spelled out so this module also loads where EventSource does not exist.
const CLOSED = 2;

export type RoomStreamHandlers = {
  /** Live messages are flowing: catch up on anything sent before. Runs on every (re)connect. */
  onReady(): void;
  onMessage(message: Message): void;
};

/** The part of EventSource this module uses, so tests can pass a fake. */
export type EventSourceLike = {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};

/**
 * Opens the room's SSE stream and keeps it open until the returned function is called. EventSource
 * reconnects by itself after a stream ends, but gives up for good when a request fails (an error
 * status, or no connection at all); those are retried here, waiting 1 s, doubling to 30 s, until a
 * stream is ready again.
 */
export function connectRoomStream(
  roomId: string,
  handlers: RoomStreamHandlers,
  createEventSource: (url: string) => EventSourceLike = (url) => new EventSource(url),
): () => void {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/stream`;
  let source: EventSourceLike;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = STREAM_RETRY_MIN_MS;

  function connect(): void {
    const current = createEventSource(url);
    source = current;
    current.addEventListener("ready", () => {
      retryMs = STREAM_RETRY_MIN_MS;
      handlers.onReady();
    });
    current.addEventListener("message", (event) => {
      const message = parseMessage(event.data);
      if (message?.roomId === roomId) handlers.onMessage(message);
    });
    current.addEventListener("error", () => {
      // While CONNECTING, EventSource is already retrying a stream that ended.
      if (current.readyState !== CLOSED) return;
      current.close();
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, STREAM_RETRY_MAX_MS);
    });
  }

  connect();
  return () => {
    clearTimeout(retryTimer);
    source.close();
  };
}

function parseMessage(data: string): Message | null {
  try {
    const result = messageSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
