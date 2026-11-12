import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRow } from "./message-row";
import { connectRoomStream, STREAM_RETRY_MAX_MS, STREAM_RETRY_MIN_MS } from "./room-stream";
import type { RoomChannelHandlers } from "./supabase/room-channel";
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
const row: MessageRow = {
  id: message.id,
  room_id: ROOM,
  author: "ana",
  body: "hi",
  created_at: "2026-10-31T10:00:00.000123+00:00",
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
  insert(value: MessageRow): void {
    this.handlers.onInsert(value);
  }
}

let subscriptions: FakeSubscription[];
const handlers = { onReady: vi.fn(), onMessage: vi.fn() };

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

function connectOn(page: FakePage): () => void {
  return connectRoomStream(ROOM, handlers, { subscribe, random: () => 1, page });
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
  vi.clearAllMocks();
});

describe("connectRoomStream", () => {
  it("subscribes to the room and passes on ready and its messages", () => {
    connect();
    expect(subscriptions.map((s) => s.roomId)).toEqual([ROOM]);
    subscriptions[0]!.ready();
    subscriptions[0]!.insert(row);
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(handlers.onMessage).toHaveBeenCalledWith(message);
  });

  it("ignores rows that are not a valid message of this room", () => {
    connect();
    subscriptions[0]!.insert({ ...row, room_id: "other" });
    subscriptions[0]!.insert({ ...row, author: 42 } as unknown as MessageRow);
    subscriptions[0]!.insert({ ...row, created_at: "not a date" });
    subscriptions[0]!.insert({ id: "m1" } as MessageRow);
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

  describe("while the tab is hidden", () => {
    it("drops the channel, and subscribes again when the tab returns", () => {
      const page = new FakePage();
      connectOn(page);
      page.setHidden(true);
      expect(subscriptions[0]!.closed).toBe(true);

      page.setHidden(false);
      expect(subscriptions).toHaveLength(2);
      subscriptions[1]!.ready();
      expect(handlers.onReady).toHaveBeenCalledOnce();
    });

    it("subscribes nothing for a tab opened in the background until it is shown", () => {
      const page = new FakePage();
      page.hidden = true;
      connectOn(page);
      expect(subscriptions).toHaveLength(0);

      page.setHidden(false);
      expect(subscriptions).toHaveLength(1);
    });

    it("cancels a pending retry, and returns with the shortest wait", () => {
      const page = new FakePage();
      connectOn(page);
      subscriptions[0]!.fail();
      vi.advanceTimersByTime(STREAM_RETRY_MIN_MS);
      subscriptions[1]!.fail();
      page.setHidden(true);
      vi.advanceTimersByTime(STREAM_RETRY_MAX_MS);
      expect(subscriptions).toHaveLength(2);

      page.setHidden(false);
      expect(subscriptions).toHaveLength(3);
      subscriptions[2]!.fail();
      expect(waitForNextSubscription()).toBe(STREAM_RETRY_MIN_MS);
    });

    it("leaves a pending retry alone when shown without having been hidden", () => {
      const page = new FakePage();
      connectOn(page);
      subscriptions[0]!.fail();
      page.setHidden(false);
      expect(subscriptions).toHaveLength(1);
      expect(waitForNextSubscription()).toBe(STREAM_RETRY_MIN_MS);
    });

    it("subscribes nothing after being disconnected", () => {
      const page = new FakePage();
      const disconnect = connectOn(page);
      page.hidden = true;
      disconnect();
      expect(page.listeners).toHaveLength(0);

      const disconnectWhileHidden = connectOn(page);
      disconnectWhileHidden();
      expect(subscriptions).toHaveLength(1);
    });
  });
});
