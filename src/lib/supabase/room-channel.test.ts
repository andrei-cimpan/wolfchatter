import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messageFromRow, type MessageRow } from "@/lib/message-row";
import type { Message } from "@/lib/types";
import { SupabaseChatRepository } from "@/server/repositories/supabase-chat-repository";
import { anonClient } from "@/server/repositories/test/supabase-client";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
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

const repo = () => new SupabaseChatRepository(anonClient());

/** Subscribes, and resolves once the channel reports ready; `onReady` runs inside that callback. */
function subscribe(roomId: string, onReady: () => void = () => {}) {
  const rows: MessageRow[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    unsubscribes.push(
      subscribeToRoomMessages(client, roomId, {
        onInsert: (row) => rows.push(row),
        onStatus: (status) => {
          if (status === "failed") reject(new Error("channel failed"));
          onReady();
          resolve();
        },
      }),
    );
  });
  return { rows, ready };
}

function delivered(rows: MessageRow[], message: Message): Promise<void> {
  return expect.poll(() => rows.map(messageFromRow), { timeout: 5000 }).toContainEqual(message);
}

// The first subscription after the stack starts or idles took over 5 s once (Realtime sets up its
// replication on demand), so these get more time than the default.
describe("subscribeToRoomMessages", { timeout: 20_000 }, () => {
  it("delivers an insert to an anonymous subscriber", async () => {
    const room = await repo().createRoom({ lat: 0, lng: 0 });
    const { rows, ready } = subscribe(room.id);
    await ready;

    const posted = await repo().postMessage(room.id, { author: "ana", body: "hello" });

    await delivered(rows, posted);
  });

  it("does not miss a message posted right after ready", async () => {
    for (let i = 0; i < 10; i++) {
      const room = await repo().createRoom({ lat: i, lng: i });
      let posting: Promise<Message> | undefined;
      const { rows, ready } = subscribe(room.id, () => {
        posting = repo().postMessage(room.id, { author: "ana", body: `right away ${i}` });
      });
      await ready;
      await delivered(rows, await posting!);
    }
  }, 40_000);

  it("only delivers the subscribed room", async () => {
    const watched = await repo().createRoom({ lat: 0, lng: 0 });
    const other = await repo().createRoom({ lat: 1, lng: 1 });
    const { rows, ready } = subscribe(watched.id);
    await ready;

    await repo().postMessage(other.id, { author: "ana", body: "elsewhere" });
    const here = await repo().postMessage(watched.id, { author: "ana", body: "here" });

    // The other room's insert happened first, so by the time this one arrives it would have too.
    await delivered(rows, here);
    expect(rows.map((row) => row.body)).toEqual(["here"]);
  });
});
