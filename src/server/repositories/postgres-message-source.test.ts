import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types";
import { InMemoryRealtimeHub, type Subscriber } from "@/server/realtime/hub";
import { PostgresChatRepository } from "./postgres-chat-repository";
import { PostgresMessageSource, parseMessageNotification } from "./postgres-message-source";
import { startTcpProxy, type TcpProxy } from "./test/tcp-proxy";
import { setupTestDatabase } from "./test/test-db";

const db = setupTestDatabase();
const repo = () => new PostgresChatRepository(db());

// Each test names its listener, so test runs sharing the database never see or kill each other's.
let applicationName = "";
const options = () => ({ minRetryMs: 10, maxRetryMs: 40, applicationName });

let source: PostgresMessageSource | undefined;
let proxy: TcpProxy | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  applicationName = `wolfchatter-test-${randomUUID()}`;
});

afterEach(async () => {
  await source?.stop();
  source = undefined;
  await proxy?.close();
  proxy = undefined;
  vi.restoreAllMocks();
});

async function startSource() {
  const received: Message[] = [];
  const onDisconnect = vi.fn();
  const onReconnect = vi.fn();
  source = new PostgresMessageSource(process.env.DATABASE_URL!, options());
  await source.start({ onMessage: (m) => received.push(m), onDisconnect, onReconnect });
  return { received, onDisconnect, onReconnect };
}

async function listenerPids(): Promise<number[]> {
  const { rows } = await db().query<{ pid: number }>(
    "select pid from pg_stat_activity where application_name = $1",
    [applicationName],
  );
  return rows.map((r) => r.pid);
}

describe("parseMessageNotification", () => {
  const row = {
    id: "8b6f2c1e-3a1d-4c55-9f3e-1d2a3b4c5d6e",
    room_id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    author: "ana",
    body: "hi",
    created_at: "2026-10-31T10:00:00.123456+02:00",
  };

  it("returns the API shape with a millisecond UTC timestamp", () => {
    expect(parseMessageNotification(JSON.stringify(row))).toEqual({
      id: row.id,
      roomId: row.room_id,
      author: "ana",
      body: "hi",
      createdAt: "2026-10-31T08:00:00.123Z",
    });
  });

  it.each([
    ["not JSON", "garbage"],
    ["a missing field", JSON.stringify({ ...row, body: undefined })],
    ["a wrong type", JSON.stringify({ ...row, author: 1 })],
    ["an unparseable timestamp", JSON.stringify({ ...row, created_at: "yesterday" })],
  ])("returns null for %s", (_, payload) => {
    expect(parseMessageNotification(payload)).toBeNull();
  });
});

describe("PostgresMessageSource", () => {
  it("delivers a posted message exactly as the repository returns it", async () => {
    const { received } = await startSource();
    const room = await repo().createRoom({ lat: 1, lng: 2 });

    const posted = await repo().postMessage(room.id, { author: "ana", body: "hello" });

    await expect.poll(() => received).toEqual([posted]);
  });

  it("drops a malformed payload and keeps delivering", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { received } = await startSource();
    await db().query("select pg_notify('messages', 'garbage')");
    const room = await repo().createRoom({ lat: 1, lng: 2 });

    const posted = await repo().postMessage(room.id, { author: "ana", body: "after" });

    await expect.poll(() => received).toEqual([posted]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("malformed"), "garbage");
    errors.mockRestore();
  });

  it("reconnects after its connection is killed and keeps delivering", async () => {
    const { received, onDisconnect, onReconnect } = await startSource();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const [pid] = await listenerPids();

    await db().query("select pg_terminate_backend($1)", [pid]);

    await expect.poll(() => onReconnect).toHaveBeenCalled();
    // The poll passes on the first call; waiting past a few retry delays catches a second one.
    await sleep(100);
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onDisconnect.mock.invocationCallOrder[0]).toBeLessThan(onReconnect.mock.invocationCallOrder[0]!);
    const pids = await listenerPids();
    expect(pids).toHaveLength(1);
    expect(pids).not.toContain(pid);
    const room = await repo().createRoom({ lat: 1, lng: 2 });
    const posted = await repo().postMessage(room.id, { author: "ana", body: "back" });
    await expect.poll(() => received).toEqual([posted]);
    errors.mockRestore();
  });

  it("rejects start when the database is unreachable, and can start again", async () => {
    const unreachable = new PostgresMessageSource("postgres://nobody@127.0.0.1:1/none", options());
    await expect(unreachable.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect: () => {} })).rejects.toThrow();

    await startSource();
    expect(await listenerPids()).toHaveLength(1);
  });

  it("closes its connection on stop and does not reconnect", async () => {
    const { onDisconnect, onReconnect } = await startSource();

    await source!.stop();

    expect(await listenerPids()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await listenerPids()).toEqual([]);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});

describe("PostgresMessageSource behind a proxy", () => {
  beforeEach(async () => {
    proxy = await startTcpProxy(process.env.DATABASE_URL!);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  async function post(body: string): Promise<Message> {
    const room = await repo().createRoom({ lat: 1, lng: 2 });
    return repo().postMessage(room.id, { author: "ana", body });
  }

  it("rejects start and leaves no connection when stopped while connecting (review #1)", async () => {
    proxy!.delayMs = 100;
    source = new PostgresMessageSource(proxy!.connectionString, options());

    const started = source.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect: () => {} });
    await source.stop();

    await expect(started).rejects.toThrow("stopped");
    await expect.poll(listenerPids).toEqual([]);
  });

  it("keeps one listener when stopped and started again during a reconnect (review #2)", async () => {
    const staleReconnect = vi.fn();
    source = new PostgresMessageSource(proxy!.connectionString, options());
    await source.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect: staleReconnect });
    proxy!.delayMs = 200;
    const attempts = proxy!.attempts.length;

    proxy!.dropAll();
    await expect.poll(() => proxy!.attempts.length).toBe(attempts + 1);
    await source.stop();
    proxy!.delayMs = 0;
    const received: Message[] = [];
    const onReconnect = vi.fn();
    await source.start({ onMessage: (m) => received.push(m), onDisconnect: () => {}, onReconnect });
    // Past the moment the stale reconnect's connection completes.
    await sleep(300);

    const posted = await post("once");
    await expect.poll(() => received).toEqual([posted]);
    await sleep(50);
    expect(received).toEqual([posted]);
    expect(await listenerPids()).toHaveLength(1);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(staleReconnect).not.toHaveBeenCalled();
  });

  // Gaps between connection attempts; each includes a failed attempt's own few milliseconds.
  function gaps(from: number, attempts: number[]): number[] {
    return attempts.map((at, i) => at - (i === 0 ? from : attempts[i - 1]!));
  }

  it("doubles the wait between failed reconnects up to the cap, then reconnects once (review #8)", async () => {
    const onReconnect = vi.fn();
    source = new PostgresMessageSource(proxy!.connectionString, { ...options(), minRetryMs: 20, maxRetryMs: 80 });
    await source.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect });
    proxy!.mode = "refuse";

    const dropped = Date.now();
    proxy!.dropAll();
    await expect.poll(() => proxy!.attempts.length, { timeout: 2_000 }).toBeGreaterThanOrEqual(6);
    proxy!.mode = "forward";
    await expect.poll(() => onReconnect).toHaveBeenCalled();

    const waits = gaps(dropped, proxy!.attempts.slice(1, 6));
    [20, 40, 80, 80, 80].forEach((expected, i) => expect(waits[i]).toBeGreaterThanOrEqual(expected - 5));
    expect(Math.max(...waits.slice(2))).toBeLessThan(150);
    await sleep(100);
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(await listenerPids()).toHaveLength(1);
  });

  // Drops the connection as soon as each reconnect lands, and returns the wait before each retry.
  async function flap(times: number, onReconnect: ReturnType<typeof vi.fn>): Promise<number[]> {
    const waits: number[] = [];
    for (let i = 0; i < times; i++) {
      const attempts = proxy!.attempts.length;
      const dropped = Date.now();
      proxy!.dropAll();
      await expect.poll(() => onReconnect.mock.calls.length, { timeout: 2_000 }).toBe(i + 1);
      waits.push(proxy!.attempts[attempts]! - dropped);
    }
    return waits;
  }

  it("keeps backing off while the connection drops right after each reconnect (review #5)", async () => {
    const onReconnect = vi.fn();
    source = new PostgresMessageSource(proxy!.connectionString, { ...options(), minRetryMs: 20, maxRetryMs: 1_000 });
    await source.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect });

    const waits = await flap(4, onReconnect);

    [20, 40, 80, 160].forEach((expected, i) => expect(waits[i]).toBeGreaterThanOrEqual(expected - 5));
  });

  it("starts again from the shortest wait once a connection has stayed up (review #5)", async () => {
    const onReconnect = vi.fn();
    const stableMs = 100;
    source = new PostgresMessageSource(proxy!.connectionString, {
      ...options(),
      minRetryMs: 20,
      maxRetryMs: 1_000,
      stableMs,
    });
    await source.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect });
    await flap(3, onReconnect);

    await sleep(stableMs + 50);
    const attempts = proxy!.attempts.length;
    const dropped = Date.now();
    proxy!.dropAll();
    await expect.poll(() => onReconnect.mock.calls.length).toBe(4);

    expect(proxy!.attempts[attempts]! - dropped).toBeLessThan(40);
  });

  it("gives up on a connection attempt that never answers (review #7)", async () => {
    proxy!.mode = "hang";
    source = new PostgresMessageSource(proxy!.connectionString, { ...options(), timeoutMs: 100 });

    const started = Date.now();
    await expect(source.start({ onMessage: () => {}, onDisconnect: () => {}, onReconnect: () => {} })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("notices a connection that silently stops answering and reconnects (review #7)", async () => {
    const received: Message[] = [];
    const onReconnect = vi.fn();
    source = new PostgresMessageSource(proxy!.connectionString, {
      ...options(),
      healthCheckMs: 50,
      timeoutMs: 100,
    });
    await source.start({ onMessage: (m) => received.push(m), onDisconnect: () => {}, onReconnect });

    proxy!.freezeAll();

    await expect.poll(() => onReconnect, { timeout: 2_000 }).toHaveBeenCalledOnce();
    const posted = await post("after the freeze");
    await expect.poll(() => received).toEqual([posted]);
  });

  it("lets a hub subscribe made during an outage receive everything posted after it resolves (review #6)", async () => {
    source = new PostgresMessageSource(proxy!.connectionString, { ...options(), minRetryMs: 50 });
    const hub = new InMemoryRealtimeHub(source);
    const room = await repo().createRoom({ lat: 1, lng: 2 });
    const subscriber = (): Subscriber & { sent: Message[] } => {
      const sent: Message[] = [];
      return { sent, send: (m) => void sent.push(m), close: vi.fn() };
    };
    const first = subscriber();
    await hub.subscribe(room.id, first);

    proxy!.mode = "refuse";
    proxy!.dropAll();
    await expect.poll(() => first.close).toHaveBeenCalled();
    const late = subscriber();
    let resolved = false;
    const subscribed = hub.subscribe(room.id, late).then(() => (resolved = true));
    await sleep(150);
    expect(resolved).toBe(false);
    proxy!.mode = "forward";
    await subscribed;

    const posted = await repo().postMessage(room.id, { author: "ana", body: "after the outage" });
    await expect.poll(() => late.sent).toEqual([posted]);
    await hub.stop();
  });
});
