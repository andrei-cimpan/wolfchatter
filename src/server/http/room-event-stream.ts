import type { RealtimeHub, Subscriber } from "@/server/realtime";
import { sseHeartbeat, sseMessage, sseReady, sseRetry, sseRetryDelay } from "./sse";

// subscribe waits out a database outage with no limit of its own. Ending the stream instead makes
// the browser retry, rather than holding a connection that looks open but receives nothing.
export const STREAM_SUBSCRIBE_TIMEOUT_MS = 10_000;

// Writes queued for a client whose connection has stalled, once its socket buffer is full. Measured
// on the production server: a stalled client's queue grows by one per write, while a reading client's
// stayed under 5 through 20,000 messages in 8 s. Past this, it is cheaper for the client to catch up.
export const STREAM_MAX_BACKLOG = 256;

/**
 * The SSE body of GET /api/rooms/:id/stream: a `ready` event once the hub has subscribed, then
 * one `message` event per new message, and heartbeats in between. The stream ends when the client
 * leaves, the hub drops it, subscribing fails or takes longer than `timeoutMs`, or the client stops
 * reading.
 */
export function openRoomEventStream(
  hub: RealtimeHub,
  roomId: string,
  signal: AbortSignal,
  { timeoutMs = STREAM_SUBSCRIBE_TIMEOUT_MS, retryMs = sseRetryDelay() } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let ended = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let end: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const leave = () => {
        ended = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", end);
        unsubscribe?.();
      };

      // Throws once the stream is closed, which tells the hub to drop this subscriber.
      const write = (text: string) => {
        controller.enqueue(encoder.encode(text));
        if ((controller.desiredSize ?? 0) >= -STREAM_MAX_BACKLOG) return;
        console.warn(`Room stream: a client of ${roomId} stopped reading; ending its stream`);
        leave();
        // Not close(), which keeps the queue until it is read, and this client is not reading.
        controller.error(new Error("The client stopped reading"));
      };

      end = () => {
        if (ended) return;
        leave();
        try {
          controller.close();
        } catch {
          // Already closed or cancelled by the client.
        }
      };

      const subscriber: Subscriber = {
        send: (message) => write(sseMessage(message)),
        heartbeat: () => write(sseHeartbeat()),
        close: () => end(),
      };

      write(sseRetry(retryMs));
      signal.addEventListener("abort", end);
      if (signal.aborted) return end();
      timer = setTimeout(() => {
        console.warn(`Room stream: subscribing to ${roomId} took over ${timeoutMs} ms; ending the stream`);
        end();
      }, timeoutMs);

      hub.subscribe(roomId, subscriber).then(
        (unsubscribeFromHub) => {
          // The client left, or the timeout fired, while subscribe was still waiting. Without this
          // the subscriber would stay in the hub until its next failed write.
          if (ended) return unsubscribeFromHub();
          clearTimeout(timer);
          unsubscribe = unsubscribeFromHub;
          write(sseReady());
        },
        (error: unknown) => {
          console.error(`Room stream: could not subscribe to ${roomId}`, error);
          end();
        },
      );
    },
    cancel() {
      end();
    },
  });
}
