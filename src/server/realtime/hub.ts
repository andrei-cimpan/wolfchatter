import type { Message } from "@/lib/types";
import type { MessageSource } from "./message-source";

// Keeps proxies from closing an idle SSE stream (DESIGN.md, Real-time delivery).
export const HEARTBEAT_INTERVAL_MS = 25_000;

// One connected client, whatever the transport (an SSE stream today; a WebSocket would fit too).
export type Subscriber = {
  send(message: Message): void;
  /** Optional: transports with their own keepalive leave it out. */
  heartbeat?(): void;
  /** The hub has dropped this subscriber; the transport should end the connection. */
  close(): void;
};

export interface RealtimeHub {
  /**
   * Resolves once live messages are flowing, so nothing posted after it resolves is missed; while
   * the source is down, it waits for it to come back. Returns the function that unsubscribes.
   * Rejects if the source cannot start or the hub stops while waiting.
   */
  subscribe(roomId: string, subscriber: Subscriber): Promise<() => void>;
}

// Fans out one source to every subscriber of a room on this instance.
export class InMemoryRealtimeHub implements RealtimeHub {
  private readonly rooms = new Map<string, Set<Subscriber>>();
  private started: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // Bumped by stop(), so a subscribe that was waiting for the source cannot join afterwards.
  private generation = 0;
  // Set while the source is down; subscribes wait on it.
  private outage: PromiseWithResolvers<void> | null = null;
  private readonly source: MessageSource;
  private readonly heartbeatMs: number;

  constructor(source: MessageSource, heartbeatMs = HEARTBEAT_INTERVAL_MS) {
    this.source = source;
    this.heartbeatMs = heartbeatMs;
  }

  async subscribe(roomId: string, subscriber: Subscriber): Promise<() => void> {
    const generation = this.generation;
    await this.start();
    while (this.outage && generation === this.generation) await this.outage.promise;
    if (generation !== this.generation) throw new Error("The realtime hub was stopped.");
    let subscribers = this.rooms.get(roomId);
    if (!subscribers) {
      subscribers = new Set();
      this.rooms.set(roomId, subscribers);
    }
    subscribers.add(subscriber);
    this.heartbeatTimer ??= setInterval(() => this.beat(), this.heartbeatMs);
    return () => this.remove(roomId, subscriber);
  }

  /** Closes every subscriber and stops the source. For shutdown and tests. */
  async stop(): Promise<void> {
    this.generation++;
    // Wakes subscribes waiting out an outage; they see the new generation and reject.
    this.outage?.resolve();
    this.outage = null;
    this.closeAll();
    const wasStarted = this.started !== null;
    this.started = null;
    // Not waiting for a pending start: MessageSource.stop may be called during one, and waiting
    // would make a subscribe right after stop() collide with the old start.
    if (wasStarted) await this.source.stop();
  }

  private start(): Promise<void> {
    if (!this.started) {
      const started = this.source.start({
        onMessage: (message) => this.deliver(message),
        onDisconnect: () => this.onSourceDown(),
        onReconnect: () => this.onSourceBack(),
      });
      this.started = started;
      // Lets the next subscriber try again instead of inheriting the failure. A start from before
      // stop() may fail after a newer one began; that must not discard the newer one.
      started.catch(() => {
        if (this.started === started) this.started = null;
      });
    }
    return this.started;
  }

  private deliver(message: Message): void {
    for (const subscriber of [...(this.rooms.get(message.roomId) ?? [])]) {
      this.call(message.roomId, subscriber, () => subscriber.send(message));
    }
  }

  private beat(): void {
    for (const [roomId, subscribers] of this.rooms) {
      for (const subscriber of [...subscribers]) this.call(roomId, subscriber, () => subscriber.heartbeat?.());
    }
  }

  // One broken connection must not stop delivery to the rest.
  private call(roomId: string, subscriber: Subscriber, action: () => void): void {
    try {
      action();
    } catch (error) {
      console.error("Realtime hub: dropping a subscriber that failed", error);
      this.remove(roomId, subscriber);
      closeQuietly(subscriber);
    }
  }

  // Messages sent while the source is down are gone. Closing every stream makes each client
  // reconnect (waiting in subscribe until the source is back) and catch up from its last message,
  // the same path as any other drop. Closing at once, not on reconnect, means no stream sits open
  // looking healthy while nothing can reach it.
  private onSourceDown(): void {
    this.outage ??= Promise.withResolvers<void>();
    this.closeAll();
  }

  private onSourceBack(): void {
    this.outage?.resolve();
    this.outage = null;
  }

  private closeAll(): void {
    const subscribers = [...this.rooms.values()].flatMap((set) => [...set]);
    this.rooms.clear();
    this.stopHeartbeat();
    for (const subscriber of subscribers) closeQuietly(subscriber);
  }

  private remove(roomId: string, subscriber: Subscriber): void {
    const subscribers = this.rooms.get(roomId);
    if (!subscribers?.delete(subscriber)) return;
    if (subscribers.size === 0) this.rooms.delete(roomId);
    if (this.rooms.size === 0) this.stopHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

function closeQuietly(subscriber: Subscriber): void {
  try {
    subscriber.close();
  } catch (error) {
    console.error("Realtime hub: subscriber failed to close", error);
  }
}
