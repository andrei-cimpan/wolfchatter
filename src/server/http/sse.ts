import type { Message } from "@/lib/types";

// How long the browser waits before reconnecting after the server ends a stream, at the least.
export const SSE_RETRY_MS = 1000;

/**
 * A reconnect delay between one and two base delays. The hub ends every stream at once when the
 * database drops, and the same delay everywhere would bring every client back in the same instant.
 */
export function sseRetryDelay(random: () => number = Math.random): number {
  return SSE_RETRY_MS + Math.floor(random() * SSE_RETRY_MS);
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform keeps compression middleware from buffering events; X-Accel-Buffering does the
  // same for nginx-style proxies.
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
} as const;

export function sseRetry(ms: number): string {
  return `retry: ${ms}\n\n`;
}

/**
 * Tells the client live messages are flowing, so it can catch up on anything sent before.
 * EventSource dispatches nothing for an event without data, hence the empty object.
 */
export function sseReady(): string {
  return "event: ready\ndata: {}\n\n";
}

// JSON.stringify escapes newlines inside strings, so the payload always fits on one data line.
export function sseMessage(message: Message): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

/** A comment line: ignored by EventSource, but keeps proxies from closing an idle stream. */
export function sseHeartbeat(): string {
  return ": ping\n\n";
}
