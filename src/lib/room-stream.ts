import { messageSchema } from "./schemas";
import type { Message } from "./types";

export const STREAM_RETRY_MIN_MS = 1000;
export const STREAM_RETRY_MAX_MS = 30_000;

// EventSource.CLOSED, spelled out so this module also loads where EventSource does not exist.
const CLOSED = 2;

// Reconnect errors in a row, with no ready between them, after which EventSource's own retry
// (every second or two, for as long as the server is unreachable) is replaced by the backoff.
const MAX_RECONNECT_ERRORS = 3;

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

export type RoomStreamOptions = {
  createEventSource?: (url: string) => EventSourceLike;
  /** For tests: picks where in its upper half each backoff wait falls. */
  random?: () => number;
};

/**
 * Opens the room's SSE stream and keeps it open until the returned function is called. After a
 * stream ends, EventSource reconnects by itself, which is left alone for a dropped stream that comes
 * straight back. It gives up for good when a request gets an error status, and while the server is
 * unreachable it keeps retrying at the server's short `retry` delay; both are handled here instead,
 * waiting 1 s, doubling to 30 s, with jitter, until a stream is ready again.
 */
export function connectRoomStream(
  roomId: string,
  handlers: RoomStreamHandlers,
  { createEventSource = (url) => new EventSource(url), random = Math.random }: RoomStreamOptions = {},
): () => void {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/stream`;
  let source: EventSourceLike;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = STREAM_RETRY_MIN_MS;
  // Counted across EventSources, so once the backoff has taken over, each new one that cannot
  // connect is handed back to it on its first error.
  let errorsSinceReady = 0;

  function connect(): void {
    const current = createEventSource(url);
    source = current;
    current.addEventListener("ready", () => {
      retryMs = STREAM_RETRY_MIN_MS;
      errorsSinceReady = 0;
      handlers.onReady();
    });
    current.addEventListener("message", (event) => {
      const message = parseMessage(event.data);
      if (message?.roomId === roomId) handlers.onMessage(message);
    });
    current.addEventListener("error", () => {
      errorsSinceReady++;
      // While CONNECTING, EventSource is already retrying; a stream that ended usually comes back.
      if (current.readyState !== CLOSED && errorsSinceReady < MAX_RECONNECT_ERRORS) return;
      current.close();
      // Anywhere in the upper half of the wait, so clients dropped together do not return together.
      retryTimer = setTimeout(connect, retryMs * (0.5 + random() / 2));
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
