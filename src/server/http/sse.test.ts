import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/types";
import { SSE_RETRY_MS, sseHeartbeat, sseMessage, sseReady, sseRetry, sseRetryDelay } from "./sse";

describe("SSE event text", () => {
  it("frames a message as one event with its JSON on a single data line", () => {
    const message: Message = {
      id: "m1",
      roomId: "r1",
      author: "ana",
      body: "line one\nline two\r\n\ndata: not an event",
      createdAt: "2026-10-31T10:00:00.000Z",
    };
    const text = sseMessage(message);
    expect(text.endsWith("\n\n")).toBe(true);
    const lines = text.slice(0, -2).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("event: message");
    expect(JSON.parse(lines[1]!.slice("data: ".length))).toEqual(message);
  });

  it("frames ready, retry and heartbeat", () => {
    expect(sseReady()).toBe("event: ready\ndata: {}\n\n");
    expect(sseRetry(1000)).toBe("retry: 1000\n\n");
    expect(sseHeartbeat()).toMatch(/^:.*\n\n$/);
  });

  it("spreads the reconnect delay over one to two base delays (review #2)", () => {
    expect(sseRetryDelay(() => 0)).toBe(SSE_RETRY_MS);
    expect(sseRetryDelay(() => 0.999)).toBe(2 * SSE_RETRY_MS - 1);
  });
});
