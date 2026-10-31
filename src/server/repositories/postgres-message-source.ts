import pg from "pg";
import { z } from "zod";
import type { Message } from "@/lib/types";
import type { MessageSource, MessageSourceHandlers } from "@/server/realtime/message-source";

// Must match the pg_notify channel in the messages trigger (db/migrations/0001_init.sql).
const CHANNEL = "messages";

const notificationSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  author: z.string(),
  body: z.string(),
  // row_to_json keeps microseconds and an offset (2026-10-31T10:00:00.123456+00:00).
  created_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

// Returns the same shape the REST API serves, so a live message equals a refetched one.
export function parseMessageNotification(payload: string): Message | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = notificationSchema.safeParse(json);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    id: row.id,
    roomId: row.room_id,
    author: row.author,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export type RetryOptions = { minRetryMs: number; maxRetryMs: number };

const DEFAULT_RETRY: RetryOptions = { minRetryMs: 1_000, maxRetryMs: 30_000 };

// Holds its own client rather than borrowing from the pool: a pool may close or reuse an idle
// client, and LISTEN lives and dies with its session.
export class PostgresMessageSource implements MessageSource {
  private client: pg.Client | null = null;
  private handlers: MessageSourceHandlers | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs: number;
  private readonly connectionString: string;
  private readonly retry: RetryOptions;

  constructor(connectionString: string, retry: RetryOptions = DEFAULT_RETRY) {
    this.connectionString = connectionString;
    this.retry = retry;
    this.retryMs = retry.minRetryMs;
  }

  async start(handlers: MessageSourceHandlers): Promise<void> {
    if (this.handlers) throw new Error("PostgresMessageSource is already started.");
    this.handlers = handlers;
    try {
      this.client = await this.connect();
    } catch (error) {
      this.handlers = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.handlers = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    this.client = null;
    await client?.end();
  }

  private async connect(): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: this.connectionString });
    // Unhandled, a dropped connection's 'error' event kills the process.
    client.on("error", (error) => {
      console.error("Postgres message source: connection error", error);
      this.onDisconnect(client);
    });
    client.on("end", () => this.onDisconnect(client));
    client.on("notification", (notification) => this.onNotification(notification));
    try {
      await client.connect();
      await client.query(`listen ${CHANNEL}`);
      return client;
    } catch (error) {
      client.end().catch(() => {});
      throw error;
    }
  }

  private onNotification({ channel, payload }: pg.Notification): void {
    if (channel !== CHANNEL || payload === undefined) return;
    const message = parseMessageNotification(payload);
    if (!message) {
      console.error("Postgres message source: dropped a malformed notification", payload);
      return;
    }
    this.handlers?.onMessage(message);
  }

  private onDisconnect(client: pg.Client): void {
    // Ignores clients still connecting (their failure rejects connect) and clients already replaced.
    if (client !== this.client) return;
    this.client = null;
    client.end().catch(() => {});
    if (this.handlers) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try {
        const client = await this.connect();
        if (!this.handlers) {
          // Stopped while connecting.
          await client.end();
          return;
        }
        this.client = client;
        this.retryMs = this.retry.minRetryMs;
        this.handlers.onReconnect();
      } catch (error) {
        console.error("Postgres message source: reconnect failed", error);
        this.retryMs = Math.min(this.retryMs * 2, this.retry.maxRetryMs);
        if (this.handlers) this.scheduleReconnect();
      }
    }, this.retryMs);
  }
}
