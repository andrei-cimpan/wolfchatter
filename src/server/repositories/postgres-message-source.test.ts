import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types";
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
  const onReconnect = vi.fn();
  source = new PostgresMessageSource(process.env.DATABASE_URL!, options());
  await source.start({ onMessage: (m) => received.push(m), onReconnect });
  return { received, onReconnect };
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
    const { received, onReconnect } = await startSource();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const [pid] = await listenerPids();

    await db().query("select pg_terminate_backend($1)", [pid]);

    await expect.poll(() => onReconnect).toHaveBeenCalledOnce();
    expect(await listenerPids()).not.toContain(pid);
    const room = await repo().createRoom({ lat: 1, lng: 2 });
    const posted = await repo().postMessage(room.id, { author: "ana", body: "back" });
    await expect.poll(() => received).toEqual([posted]);
    errors.mockRestore();
  });

  it("rejects start when the database is unreachable, and can start again", async () => {
    const unreachable = new PostgresMessageSource("postgres://nobody@127.0.0.1:1/none", options());
    await expect(unreachable.start({ onMessage: () => {}, onReconnect: () => {} })).rejects.toThrow();

    await startSource();
    expect(await listenerPids()).toHaveLength(1);
  });

  it("closes its connection on stop and does not reconnect", async () => {
    const { onReconnect } = await startSource();

    await source!.stop();

    expect(await listenerPids()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await listenerPids()).toEqual([]);
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe("PostgresMessageSource behind a proxy", () => {
  beforeEach(async () => {
    proxy = await startTcpProxy(process.env.DATABASE_URL!);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects start and leaves no connection when stopped while connecting (review #1)", async () => {
    proxy!.delayMs = 100;
    source = new PostgresMessageSource(proxy!.connectionString, options());

    const started = source.start({ onMessage: () => {}, onReconnect: () => {} });
    await source.stop();

    await expect(started).rejects.toThrow("stopped");
    await expect.poll(listenerPids).toEqual([]);
  });
});
