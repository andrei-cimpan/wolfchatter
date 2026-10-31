import type { Message } from "@/lib/types";

export type MessageSourceHandlers = {
  onMessage(message: Message): void;
  /** The feed was interrupted and is back. Messages sent during the gap were not delivered. */
  onReconnect(): void;
};

// Where new messages come from (Postgres LISTEN today; Redis pub/sub or similar later).
// The hub depends only on this, so swapping the source does not touch fan-out or transports.
export interface MessageSource {
  /** Resolves once messages are being received. Rejects if the first connection fails. */
  start(handlers: MessageSourceHandlers): Promise<void>;
  /** May be called while start is pending; that start then rejects. start may be called again at once. */
  stop(): Promise<void>;
}
