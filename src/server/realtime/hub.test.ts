import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types";
import { HEARTBEAT_INTERVAL_MS, InMemoryRealtimeHub, type Subscriber } from "./hub";
import type { MessageSource, MessageSourceHandlers } from "./message-source";

class FakeSource implements MessageSource {
  handlers: MessageSourceHandlers | null = null;
  starts = 0;
  stops = 0;
  private pending: { resolve: () => void; reject: (error: Error) => void } | null = null;

  start(handlers: MessageSourceHandlers): Promise<void> {
    // Like PostgresMessageSource, which holds one set of handlers at a time.
    if (this.handlers) throw new Error("already started");
    this.starts++;
    this.handlers = handlers;
    return new Promise((resolve, reject) => (this.pending = { resolve, reject }));
  }

  async stop(): Promise<void> {
    this.stops++;
    this.handlers = null;
  }

  ready(): void {
    this.pending?.resolve();
  }

  pendingStart() {
    return this.pending;
  }

  fail(): void {
    this.handlers = null;
    this.pending?.reject(new Error("database down"));
  }

  emit(message: Message): void {
    this.handlers!.onMessage(message);
  }
}

function message(roomId: string, body = "hi"): Message {
  return { id: `${roomId}-${body}`, roomId, author: "ana", body, createdAt: "2026-10-31T10:00:00.000Z" };
}

function subscriber(): Subscriber & { sent: Message[] } {
  const sent: Message[] = [];
  return { sent, send: vi.fn((m: Message) => void sent.push(m)), heartbeat: vi.fn(), close: vi.fn() };
}

let source: FakeSource;
let hub: InMemoryRealtimeHub;

beforeEach(() => {
  source = new FakeSource();
  hub = new InMemoryRealtimeHub(source);
});

afterEach(async () => {
  // Clears the heartbeat interval left by tests that run on real timers.
  await hub.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function subscribe(roomId: string, s: Subscriber) {
  const subscribed = hub.subscribe(roomId, s);
  source.ready();
  return subscribed;
}

describe("InMemoryRealtimeHub", () => {
  it("waits for the source to start before subscribing", async () => {
    let resolved = false;
    const subscribed = hub.subscribe("a", subscriber()).then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);

    source.ready();
    await subscribed;
    expect(resolved).toBe(true);
  });

  it("starts the source once for many subscribers", async () => {
    await Promise.all([subscribe("a", subscriber()), subscribe("b", subscriber())]);
    await subscribe("a", subscriber());
    expect(source.starts).toBe(1);
  });

  it("delivers a message only to its room's subscribers", async () => {
    const [a1, a2, b] = [subscriber(), subscriber(), subscriber()];
    await subscribe("a", a1);
    await subscribe("a", a2);
    await subscribe("b", b);

    source.emit(message("a"));

    expect(a1.sent).toEqual([message("a")]);
    expect(a2.sent).toEqual([message("a")]);
    expect(b.sent).toEqual([]);
  });

  it("stops delivering after unsubscribe, and unsubscribing twice is harmless", async () => {
    const s = subscriber();
    const unsubscribe = await subscribe("a", s);

    unsubscribe();
    unsubscribe();
    source.emit(message("a"));

    expect(s.sent).toEqual([]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it("drops and closes a subscriber whose send throws, and still delivers to the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = subscriber();
    broken.send = vi.fn(() => {
      throw new Error("stream closed");
    });
    const healthy = subscriber();
    await subscribe("a", broken);
    await subscribe("a", healthy);

    source.emit(message("a", "one"));
    source.emit(message("a", "two"));

    expect(broken.send).toHaveBeenCalledOnce();
    expect(broken.close).toHaveBeenCalledOnce();
    expect(healthy.sent).toEqual([message("a", "one"), message("a", "two")]);
  });

  it("closes every subscriber when the source reconnects", async () => {
    const [a, b] = [subscriber(), subscriber()];
    await subscribe("a", a);
    await subscribe("b", b);

    source.handlers!.onReconnect();
    source.emit(message("a"));

    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
    expect(a.sent).toEqual([]);
  });

  it("rejects subscribe when the source fails to start, and tries again on the next one", async () => {
    const first = hub.subscribe("a", subscriber());
    source.fail();
    await expect(first).rejects.toThrow("database down");

    const s = subscriber();
    await subscribe("a", s);
    source.emit(message("a"));

    expect(source.starts).toBe(2);
    expect(s.sent).toEqual([message("a")]);
  });

  describe("heartbeat", () => {
    beforeEach(() => vi.useFakeTimers());

    it("beats every 25 seconds while anyone is subscribed", async () => {
      const [a, b] = [subscriber(), subscriber()];
      await subscribe("a", a);
      const unsubscribeB = await subscribe("b", b);

      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
      expect(a.heartbeat).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(a.heartbeat).toHaveBeenCalledOnce();
      expect(b.heartbeat).toHaveBeenCalledOnce();

      unsubscribeB();
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(a.heartbeat).toHaveBeenCalledTimes(2);
      expect(b.heartbeat).toHaveBeenCalledOnce();
    });

    it("stops the timer when the last subscriber leaves", async () => {
      const unsubscribe = await subscribe("a", subscriber());
      expect(vi.getTimerCount()).toBe(1);

      unsubscribe();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("skips subscribers without a heartbeat and drops ones whose heartbeat throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const quiet: Subscriber = { send: vi.fn(), close: vi.fn() };
      const broken = subscriber();
      broken.heartbeat = vi.fn(() => {
        throw new Error("stream closed");
      });
      await subscribe("a", quiet);
      await subscribe("a", broken);

      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      source.emit(message("a"));

      expect(broken.close).toHaveBeenCalledOnce();
      expect(broken.send).not.toHaveBeenCalled();
      expect(quiet.close).not.toHaveBeenCalled();
      expect(quiet.send).toHaveBeenCalledOnce();
    });
  });

  it("stop closes subscribers and stops the source", async () => {
    const s = subscriber();
    await subscribe("a", s);

    await hub.stop();

    expect(s.close).toHaveBeenCalledOnce();
    expect(source.stops).toBe(1);
  });

  it("rejects a subscribe still waiting for the source when the hub stops (review #3)", async () => {
    vi.useFakeTimers();
    const s = subscriber();
    const subscribed = hub.subscribe("a", s);

    const stopped = hub.stop();
    source.ready();
    await stopped;

    await expect(subscribed).rejects.toThrow("stopped");
    expect(vi.getTimerCount()).toBe(0);
    expect(s.heartbeat).not.toHaveBeenCalled();
  });

  it("subscribes again right after stop while the first start is still pending (review #4)", async () => {
    const first = hub.subscribe("a", subscriber());
    const firstStart = source.pendingStart()!;

    const stopped = hub.stop();
    const s = subscriber();
    const second = hub.subscribe("a", s);
    await stopped;
    // A stopped source settles its old start later, as PostgresMessageSource does once it connects.
    firstStart.reject(new Error("stopped while starting"));
    source.ready();

    await expect(first).rejects.toThrow("stopped");
    await expect(second).resolves.toBeTypeOf("function");
    source.emit(message("a"));
    expect(s.sent).toEqual([message("a")]);
    // The old start's failure must not discard the new one.
    await hub.subscribe("b", subscriber());
    expect(source.starts).toBe(2);
  });
});
