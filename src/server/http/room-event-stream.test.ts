import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types";
import type { RealtimeHub, Subscriber } from "@/server/realtime";
import { openRoomEventStream } from "./room-event-stream";

// A hub whose subscribe settles only when the test says so.
class FakeHub implements RealtimeHub {
  subscriber: Subscriber | null = null;
  readonly unsubscribe = vi.fn();
  private pending = Promise.withResolvers<() => void>();

  subscribe(_roomId: string, subscriber: Subscriber): Promise<() => void> {
    this.subscriber = subscriber;
    return this.pending.promise;
  }
  resolve(): void {
    this.pending.resolve(this.unsubscribe);
  }
  reject(): void {
    this.pending.reject(new Error("database down"));
  }
}

const message: Message = { id: "m1", roomId: "r1", author: "ana", body: "hi", createdAt: "2026-10-31T10:00:00.000Z" };

// Lets pending promise callbacks run.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Reads the stream in the background; `drain` returns the text since the last call and whether it ended.
function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let done = false;
  void (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return void (done = true);
      text += decoder.decode(next.value);
    }
  })();
  return {
    reader,
    async drain() {
      await settle();
      const result = { text, done };
      text = "";
      return result;
    },
  };
}

function open(hub: FakeHub, controller = new AbortController(), timeoutMs = 10_000) {
  const stream = openRoomEventStream(hub, "r1", controller.signal, { timeoutMs, retryMs: 1000 });
  return { ...collect(stream), controller };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("openRoomEventStream", () => {
  it("sends retry first, ready only once subscribed, then messages and heartbeats", async () => {
    const hub = new FakeHub();
    const { drain } = open(hub);
    expect(await drain()).toEqual({ text: "retry: 1000\n\n", done: false });

    hub.resolve();
    await settle();
    hub.subscriber!.send(message);
    hub.subscriber!.heartbeat!();
    const { text } = await drain();
    expect(text).toBe(`event: ready\ndata: {}\n\nevent: message\ndata: ${JSON.stringify(message)}\n\n: ping\n\n`);
  });

  it("ends the stream when the hub closes the subscriber", async () => {
    const hub = new FakeHub();
    const { drain } = open(hub);
    hub.resolve();
    await settle();
    hub.subscriber!.close();
    expect((await drain()).done).toBe(true);
  });

  it("unsubscribes when the client leaves", async () => {
    const hub = new FakeHub();
    const { reader, controller } = open(hub);
    hub.resolve();
    await settle();
    controller.abort();
    expect(hub.unsubscribe).toHaveBeenCalledOnce();
    // A write after the client left throws, which is how the hub would notice if it had not been told.
    expect(() => hub.subscriber!.send(message)).toThrow();
    await reader.cancel();
    expect(hub.unsubscribe).toHaveBeenCalledOnce();
  });

  it("unsubscribes when the reader cancels", async () => {
    const hub = new FakeHub();
    const { reader } = open(hub);
    hub.resolve();
    await settle();
    await reader.cancel();
    expect(hub.unsubscribe).toHaveBeenCalledOnce();
  });

  it("unsubscribes once subscribe resolves if the client left while it was waiting", async () => {
    const hub = new FakeHub();
    const { drain, controller } = open(hub);
    controller.abort();
    expect((await drain()).done).toBe(true);
    expect(hub.unsubscribe).not.toHaveBeenCalled();
    hub.resolve();
    await settle();
    expect(hub.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not subscribe for a request that already aborted", async () => {
    const hub = new FakeHub();
    const controller = new AbortController();
    controller.abort();
    const { drain } = open(hub, controller);
    expect((await drain()).done).toBe(true);
    expect(hub.subscriber).toBeNull();
  });

  it("ends the stream when subscribing takes too long, and unsubscribes if it resolves later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    const hub = new FakeHub();
    const { drain } = open(hub, new AbortController(), 50);
    vi.advanceTimersByTime(50);
    vi.useRealTimers();
    const { text, done } = await drain();
    expect(done).toBe(true);
    expect(text).not.toContain("ready");
    hub.resolve();
    await settle();
    expect(hub.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not time out once subscribed", async () => {
    vi.useFakeTimers();
    const hub = new FakeHub();
    open(hub, new AbortController(), 50);
    hub.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the stream when subscribe rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hub = new FakeHub();
    const { drain } = open(hub);
    hub.reject();
    expect(await drain()).toEqual({ text: "retry: 1000\n\n", done: true });
  });
});
