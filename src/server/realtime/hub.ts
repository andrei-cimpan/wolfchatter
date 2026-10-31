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
   * Resolves once live messages are flowing, so nothing posted after it resolves is missed.
   * Returns the function that unsubscribes.
   */
  subscribe(roomId: string, subscriber: Subscriber): Promise<() => void>;
}

// Fans out one source to every subscriber of a room on this instance.
export class InMemoryRealtimeHub implements RealtimeHub {
  private readonly rooms = new Map<string, Set<Subscriber>>();
  private started: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly source: MessageSource;
  private readonly heartbeatMs: number;

  constructor(source: MessageSource, heartbeatMs = HEARTBEAT_INTERVAL_MS) {
    this.source = source;
    this.heartbeatMs = heartbeatMs;
  }

  async subscribe(roomId: string, subscriber: Subscriber): Promise<() => void> {
    await this.start();
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
    this.closeAll();
    const started = this.started;
    this.started = null;
    if (started) await started.then(() => this.source.stop(), () => {});
  }

  private start(): Promise<void> {
    this.started ??= this.source
      .start({ onMessage: (message) => this.deliver(message), onReconnect: () => this.closeAll() })
      .catch((error: unknown) => {
        // Lets the next subscriber try again instead of inheriting the failure.
        this.started = null;
        throw error;
      });
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

  // After a source reconnect, messages from the gap are gone. Closing every stream makes each
  // client reconnect and catch up from its last message, the same path as any other drop.
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
