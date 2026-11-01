import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectRoomStream, type EventSourceLike, STREAM_RETRY_MAX_MS, STREAM_RETRY_MIN_MS } from "./room-stream";
import type { Message } from "./types";

const ROOM = "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a";
const message: Message = { id: "m1", roomId: ROOM, author: "ana", body: "hi", createdAt: "2026-10-31T10:00:00.000Z" };

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data = ""): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }
  /** A stream that ended: EventSource is reconnecting by itself. */
  drop(): void {
    this.readyState = 0;
    this.emit("error");
  }
  /** A request that failed: EventSource has given up. */
  fail(): void {
    this.readyState = 2;
    this.emit("error");
  }
}

let sources: FakeEventSource[];
const handlers = { onReady: vi.fn(), onMessage: vi.fn() };

// random() = 1 waits the full backoff, which keeps most waits exact.
function connect(random = () => 1): () => void {
  return connectRoomStream(ROOM, handlers, {
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    random,
  });
}

/** How long until the next EventSource opens, in steps of 100 ms. */
function waitForNextSource(): number {
  const before = sources.length;
  let waited = 0;
  while (sources.length === before && waited < STREAM_RETRY_MAX_MS * 2) {
    vi.advanceTimersByTime(100);
    waited += 100;
  }
  return waited;
}

beforeEach(() => {
  sources = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("connectRoomStream", () => {
  it("opens the room's stream and passes on ready and its messages", () => {
    connect();
    expect(sources.map((s) => s.url)).toEqual([`/api/rooms/${ROOM}/stream`]);
    sources[0]!.emit("ready", "{}");
    sources[0]!.emit("message", JSON.stringify(message));
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(handlers.onMessage).toHaveBeenCalledWith(message);
  });

  it("ignores events that are not a message of this room", () => {
    connect();
    sources[0]!.emit("message", "not json");
    sources[0]!.emit("message", JSON.stringify({ id: "m1" }));
    sources[0]!.emit("message", JSON.stringify({ ...message, roomId: "other" }));
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it("leaves a dropped stream to EventSource's own reconnect", () => {
    connect();
    sources[0]!.drop();
    vi.advanceTimersByTime(STREAM_RETRY_MAX_MS);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.closed).toBe(false);
  });

  it("retries a failed request, waiting longer each time up to the maximum", () => {
    connect();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      sources.at(-1)!.fail();
      waits.push(waitForNextSource());
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(sources.slice(0, -1).every((s) => s.closed)).toBe(true);
  });

  it("spreads each wait over its upper half, so clients dropped together do not return together", () => {
    connect(() => 0);
    sources[0]!.fail();
    expect(waitForNextSource()).toBe(STREAM_RETRY_MIN_MS / 2);
    sources[1]!.fail();
    expect(waitForNextSource()).toBe(STREAM_RETRY_MIN_MS);
  });

  it("takes over with its own backoff when EventSource keeps failing to reconnect (review #2)", () => {
    // An unreachable server: EventSource retries every second by itself, staying CONNECTING.
    connect();
    sources[0]!.emit("ready", "{}");
    sources[0]!.drop();
    sources[0]!.drop();
    expect(sources[0]!.closed).toBe(false);
    sources[0]!.drop();
    expect(sources[0]!.closed).toBe(true);
    expect(waitForNextSource()).toBe(STREAM_RETRY_MIN_MS);

    // Still unreachable: the new EventSource is closed on its first error, and the wait doubles.
    sources[1]!.drop();
    expect(sources[1]!.closed).toBe(true);
    expect(waitForNextSource()).toBe(STREAM_RETRY_MIN_MS * 2);

    // Back: a ready resets the count, so a single drop is again left to EventSource.
    sources[2]!.emit("ready", "{}");
    sources[2]!.drop();
    expect(sources[2]!.closed).toBe(false);
  });

  it("goes back to the shortest wait once a stream is ready", () => {
    connect();
    sources[0]!.fail();
    vi.advanceTimersByTime(STREAM_RETRY_MIN_MS);
    sources[1]!.fail();
    vi.advanceTimersByTime(STREAM_RETRY_MIN_MS * 2);
    sources[2]!.emit("ready", "{}");
    sources[2]!.fail();
    vi.advanceTimersByTime(STREAM_RETRY_MIN_MS);
    expect(sources).toHaveLength(4);
  });

  it("closes the stream and cancels a pending retry when disconnected", () => {
    const disconnect = connect();
    sources[0]!.fail();
    disconnect();
    vi.advanceTimersByTime(STREAM_RETRY_MAX_MS);
    expect(sources).toHaveLength(1);

    const disconnectAgain = connect();
    disconnectAgain();
    expect(sources[1]!.closed).toBe(true);
  });
});
