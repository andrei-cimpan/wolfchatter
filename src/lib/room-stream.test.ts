import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectRoomStream, STREAM_RETRY_MAX_MS, STREAM_RETRY_MIN_MS } from "./room-stream";
import type { LiveMessageRow, RoomChannelHandlers } from "./supabase/room-channel";
import type { Message } from "./types";

const ROOM = "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a";
const message: Message = {
  id: "5d7c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
  roomId: ROOM,
  author: "ana",
  body: "hi",
  createdAt: "2026-10-31T10:00:00.000Z",
};
// As Realtime sends it: column names, and the timestamp as Postgres text.
const POSTER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const row: LiveMessageRow = {
  id: message.id,
  room_id: ROOM,
  author: "ana",
  body: "hi",
  created_at: "2026-10-31T10:00:00.000123+00:00",
  user_id: POSTER,
};

class FakeSubscription {
  closed = false;
  readonly roomId: string;
  private readonly handlers: RoomChannelHandlers;

  constructor(roomId: string, handlers: RoomChannelHandlers) {
    this.roomId = roomId;
    this.handlers = handlers;
  }
  ready(): void {
    this.handlers.onStatus("ready");
  }
  fail(): void {
    this.handlers.onStatus("failed");
  }
  insert(value: LiveMessageRow): void {
    this.handlers.onInsert(value);
  }
  deleteRoom(): void {
    this.handlers.onRoomDeleted();
  }
}

let subscriptions: FakeSubscription[];
const handlers = { onReady: vi.fn(), onMessage: vi.fn(), onClosed: vi.fn() };

function subscribe(roomId: string, channelHandlers: RoomChannelHandlers): () => void {
  const subscription = new FakeSubscription(roomId, channelHandlers);
  subscriptions.push(subscription);
  return () => {
    subscription.closed = true;
  };
}

// random() = 1 waits the full backoff, which keeps most waits exact.
function connect(random = () => 1): () => void {
  return connectRoomStream(ROOM, handlers, { subscribe, random });
}

class FakePage {
  hidden = false;
  listeners: (() => void)[] = [];
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners = this.listeners.filter((other) => other !== listener);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

/** How long until the next subscription, in steps of 100 ms. */
function waitForNextSubscription(): number {
  const before = subscriptions.length;
  let waited = 0;
  while (subscriptions.length === before && waited < STREAM_RETRY_MAX_MS * 2) {
    vi.advanceTimersByTime(100);
    waited += 100;
  }
  return waited;
}

beforeEach(() => {
  subscriptions = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("connectRoomStream", () => {
  it("subscribes to the room and passes on ready and its messages", () => {
    connect();
    expect(subscriptions.map((s) => s.roomId)).toEqual([ROOM]);
    subscriptions[0]!.ready();
    subscriptions[0]!.insert(row);
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(handlers.onMessage).toHaveBeenCalledWith(message, POSTER);
  });

  it("passes no poster for a row without a usable user id", () => {
    connect();
    subscriptions[0]!.insert({ ...row, user_id: 42 } as unknown as LiveMessageRow);
    expect(handlers.onMessage).toHaveBeenCalledWith(message, null);
  });

  it("ignores rows that are not a valid message of this room", () => {
    connect();
    subscriptions[0]!.insert({ ...row, room_id: "other" });
    subscriptions[0]!.insert({ ...row, author: 42 } as unknown as LiveMessageRow);
    subscriptions[0]!.insert({ ...row, created_at: "not a date" });
    subscriptions[0]!.insert({ id: "m1" } as LiveMessageRow);
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it("drops a failed channel and resubscribes, waiting longer each time up to the maximum", () => {
    connect();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      subscriptions.at(-1)!.fail();
      waits.push(waitForNextSubscription());
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(subscriptions.slice(0, -1).every((s) => s.closed)).toBe(true);
  });

  it("spreads each wait over its upper half, so clients dropped together do not return together", () => {
    connect(() => 0);
    subscriptions[0]!.fail();
    expect(waitForNextSubscription()).toBe(STREAM_RETRY_MIN_MS / 2);
    subscriptions[1]!.fail();
    expect(waitForNextSubscription()).toBe(STREAM_RETRY_MIN_MS);
  });

  it("goes back to the shortest wait once a channel is ready", () => {
    connect();
    subscriptions[0]!.fail();
    vi.advanceTimersByTime(STREAM_RETRY_MIN_MS);
    subscriptions[1]!.fail();
    vi.advanceTimersByTime(STREAM_RETRY_MIN_MS * 2);
    subscriptions[2]!.ready();
    subscriptions[2]!.fail();
    vi.advanceTimersByTime(STREAM_RETRY_MIN_MS);
    expect(subscriptions).toHaveLength(4);
  });

  it("ignores a channel it has already dropped", () => {
    connect();
    subscriptions[0]!.fail();
    subscriptions[0]!.fail();
    subscriptions[0]!.ready();
    expect(handlers.onReady).not.toHaveBeenCalled();
    expect(waitForNextSubscription()).toBe(STREAM_RETRY_MIN_MS);
    expect(subscriptions).toHaveLength(2);
  });

  it("unsubscribes and cancels a pending retry when disconnected", () => {
    const disconnect = connect();
    subscriptions[0]!.fail();
    disconnect();
    vi.advanceTimersByTime(STREAM_RETRY_MAX_MS);
    expect(subscriptions).toHaveLength(1);

    const disconnectAgain = connect();
    disconnectAgain();
    expect(subscriptions[1]!.closed).toBe(true);
  });

  // The notifications need a background tab to hear new messages (FR10); the heartbeat runs in a
  // worker, so throttling cannot starve it.
  it("keeps its channel while the tab is hidden", () => {
    const page = new FakePage();
    vi.stubGlobal("document", page);
    connect();
    subscriptions[0]!.ready();
    page.setHidden(true);
    subscriptions[0]!.insert(row);

    expect(subscriptions[0]!.closed).toBe(false);
    expect(handlers.onMessage).toHaveBeenCalledWith(message, POSTER);
    page.setHidden(false);
    expect(subscriptions).toHaveLength(1);
  });
});

describe("when the room is deleted", () => {
  it("reports it once, and lets the channel go for good", () => {
    const stop = connect();
    subscriptions[0]!.ready();
    subscriptions[0]!.deleteRoom();

    expect(handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(subscriptions[0]!.closed).toBe(true);
    vi.advanceTimersByTime(STREAM_RETRY_MAX_MS * 2);
    expect(subscriptions).toHaveLength(1);
    stop();
  });
});
