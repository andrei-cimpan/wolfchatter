import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messageFromRow, type MessageRow } from "@/lib/message-row";
import type { Message } from "@/lib/types";
import { SupabaseChatRepository } from "@/server/repositories/supabase-chat-repository";
import { anonClient } from "@/server/repositories/test/supabase-client";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { createTestUser } from "@/server/repositories/test/test-users";
import { subscribeToRoomMessages } from "./room-channel";

setupTestDatabase();

let client: SupabaseClient;
let unsubscribes: (() => void)[];

beforeEach(() => {
  client = anonClient();
  unsubscribes = [];
});
afterEach(async () => {
  for (const unsubscribe of unsubscribes) unsubscribe();
  await client.removeAllChannels();
});

// Posts come from a signed-in user; the channel itself listens signed out.
let poster: SupabaseClient;
beforeEach(async () => {
  poster = (await createTestUser({ full_name: "Ana Popescu" })).client;
});
const repo = () => new SupabaseChatRepository(poster);

/** Subscribes, and resolves once the channel reports ready; `onReady` runs inside that callback. */
function subscribe(roomId: string, onReady: () => void = () => {}) {
  const rows: MessageRow[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    unsubscribes.push(
      subscribeToRoomMessages(client, roomId, {
        onInsert: (row) => rows.push(row),
        onStatus: (status) => {
          if (status === "failed") return reject(new Error("channel failed"));
          onReady();
          resolve();
        },
      }),
    );
  });
  return { rows, ready };
}

// A duplicate would follow within milliseconds on the same socket; this waits well past that.
const SETTLE_MS = 300;

/** Waits for the message, then checks it came exactly once. */
async function deliveredOnce(rows: MessageRow[], message: Message): Promise<void> {
  await expect.poll(() => rows.map(messageFromRow), { timeout: 5000 }).toContainEqual(message);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  expect(rows.filter((row) => row.id === message.id)).toHaveLength(1);
}

// The first subscription after the stack starts or idles took over 5 s once (Realtime sets up its
// replication on demand), so these get more time than the default.
describe("subscribeToRoomMessages", { timeout: 20_000 }, () => {
  it("delivers an insert to an anonymous subscriber", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    const { rows, ready } = subscribe(room.id);
    await ready;

    const posted = await repo().postMessage(room.id, { body: "hello" });

    await deliveredOnce(rows, posted);
  });

  it("does not miss a message posted right after ready", async () => {
    for (let i = 0; i < 10; i++) {
      const room = await repo().createRoom({ lat: i, lng: i });
      let posting: Promise<Message> | undefined;
      const { rows, ready } = subscribe(room.id, () => {
        posting = repo().postMessage(room.id, { body: `right away ${i}` });
      });
      await ready;
      await deliveredOnce(rows, await posting!);
    }
  }, 40_000);

  it("only delivers the subscribed room", async () => {
    const watched = await repo().createRoom({ lat: 0, lng: 0 });
    const other = await repo().createRoom({ lat: 1, lng: 1 });
    const { rows, ready } = subscribe(watched.id);
    await ready;

    await repo().postMessage(other.id, { body: "elsewhere" });
    const here = await repo().postMessage(watched.id, { body: "here" });

    // The other room's insert happened first, so by the time this one arrives it would have too.
    await deliveredOnce(rows, here);
    expect(rows.map((row) => row.body)).toEqual(["here"]);
  });
});
