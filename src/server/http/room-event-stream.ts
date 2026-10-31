import type { RealtimeHub, Subscriber } from "@/server/realtime";
import { sseHeartbeat, sseMessage, sseReady, sseRetry } from "./sse";

// subscribe waits out a database outage with no limit of its own. Ending the stream instead makes
// the browser retry, rather than holding a connection that looks open but receives nothing.
export const STREAM_SUBSCRIBE_TIMEOUT_MS = 10_000;

/**
 * The SSE body of GET /api/rooms/:id/stream: a `ready` event once the hub has subscribed, then
 * one `message` event per new message, and heartbeats in between. The stream ends when the client
 * leaves, the hub drops it, or subscribing fails or takes longer than `timeoutMs`.
 */
export function openRoomEventStream(
  hub: RealtimeHub,
  roomId: string,
  signal: AbortSignal,
  timeoutMs = STREAM_SUBSCRIBE_TIMEOUT_MS,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let ended = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let end: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Throws once the stream is closed, which tells the hub to drop this subscriber.
      const write = (text: string) => controller.enqueue(encoder.encode(text));

      end = () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", end);
        unsubscribe?.();
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

      write(sseRetry());
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
