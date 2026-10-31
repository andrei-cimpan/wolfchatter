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

export type MessageSourceOptions = {
  minRetryMs: number;
  maxRetryMs: number;
  /** How long a connection must stay up before the wait drops back to minRetryMs. */
  stableMs: number;
  /** How often the listener checks its connection still answers. */
  healthCheckMs: number;
  /** Limit for connecting, a health check, and closing. */
  timeoutMs: number;
  /** Names the session in pg_stat_activity, so the listener can be told apart from pool clients. */
  applicationName: string;
};

const DEFAULTS: MessageSourceOptions = {
  minRetryMs: 1_000,
  maxRetryMs: 30_000,
  stableMs: 30_000,
  healthCheckMs: 30_000,
  timeoutMs: 10_000,
  applicationName: "wolfchatter-realtime",
};

// Holds its own client rather than borrowing from the pool: a pool may close or reuse an idle
// client, and LISTEN lives and dies with its session.
export class PostgresMessageSource implements MessageSource {
  private client: pg.Client | null = null;
  private handlers: MessageSourceHandlers | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs: number;
  // Bumped by stop(), so a connection that finishes after it is closed instead of adopted.
  private generation = 0;
  private readonly connectionString: string;
  private readonly options: MessageSourceOptions;

  constructor(connectionString: string, options: Partial<MessageSourceOptions> = {}) {
    this.connectionString = connectionString;
    this.options = { ...DEFAULTS, ...options };
    this.retryMs = this.options.minRetryMs;
  }

  async start(handlers: MessageSourceHandlers): Promise<void> {
    if (this.handlers) throw new Error("PostgresMessageSource is already started.");
    this.handlers = handlers;
    const generation = this.generation;
    let client: pg.Client;
    try {
      client = await this.connect();
    } catch (error) {
      if (generation === this.generation) this.handlers = null;
      throw error;
    }
    if (generation !== this.generation) {
      await endWithin(client, this.options.timeoutMs);
      throw new Error("PostgresMessageSource was stopped while starting.");
    }
    this.adopt(client);
  }

  async stop(): Promise<void> {
    this.generation++;
    this.handlers = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearTimers();
    const client = this.client;
    this.client = null;
    if (client) await endWithin(client, this.options.timeoutMs);
  }

  private async connect(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: this.connectionString,
      application_name: this.options.applicationName,
      connectionTimeoutMillis: this.options.timeoutMs,
      query_timeout: this.options.timeoutMs,
      keepAlive: true,
    });
    // Unhandled, a dropped connection's 'error' event kills the process.
    client.on("error", (error) => {
      console.error("Postgres message source: connection error", error);
      this.onDisconnect(client);
    });
    client.on("end", () => this.onDisconnect(client));
    client.on("notification", (notification) => {
      // A client replaced by a newer one may still be open for a moment; only one may deliver.
      if (client === this.client) this.onNotification(notification);
    });
    try {
      await client.connect();
      await client.query(`listen ${CHANNEL}`);
      return client;
    } catch (error) {
      client.end().catch(() => {});
      throw error;
    }
  }

  // A connection that drops right after connecting must not reset the backoff, or a flapping
  // database gets retried (and every stream closed) at the shortest wait forever.
  private adopt(client: pg.Client): void {
    this.client = client;
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.retryMs = this.options.minRetryMs;
    }, this.options.stableMs);
    this.scheduleHealthCheck(client);
  }

  // A connection dropped without a FIN (a NAT or load balancer forgetting it) raises no error, so
  // LISTEN would go quiet for good. A periodic query notices; it also keeps the connection from idling out.
  private scheduleHealthCheck(client: pg.Client): void {
    this.healthTimer = setTimeout(async () => {
      this.healthTimer = null;
      try {
        await client.query("select 1");
      } catch (error) {
        if (client !== this.client) return;
        console.error("Postgres message source: health check failed", error);
        this.onDisconnect(client);
        return;
      }
      if (client === this.client) this.scheduleHealthCheck(client);
    }, this.options.healthCheckMs);
  }

  private clearTimers(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = null;
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
    this.clearTimers();
    endWithin(client, this.options.timeoutMs).catch(() => {});
    if (!this.handlers) return;
    this.handlers.onDisconnect();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const generation = this.generation;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, this.options.maxRetryMs);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try {
        const client = await this.connect();
        // Stopped while connecting, and perhaps started again with a client of its own.
        if (generation !== this.generation || !this.handlers) {
          await endWithin(client, this.options.timeoutMs);
          return;
        }
        this.adopt(client);
        this.handlers.onReconnect();
      } catch (error) {
        console.error("Postgres message source: reconnect failed", error);
        if (generation === this.generation && this.handlers) this.scheduleReconnect();
      }
    }, delay);
  }
}

// end() waits for the server to close its side, which a dead connection never does.
function endWithin(client: pg.Client, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  return Promise.race([client.end(), timeout]).finally(() => clearTimeout(timer));
}
