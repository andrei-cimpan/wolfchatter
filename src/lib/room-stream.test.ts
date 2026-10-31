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

function connect(): () => void {
  return connectRoomStream(ROOM, handlers, (url) => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  });
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
      const before = sources.length;
      let waited = 0;
      while (sources.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(sources.slice(0, -1).every((s) => s.closed)).toBe(true);
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
