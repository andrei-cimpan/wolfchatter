import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageRow } from "@/lib/message-row";

export type RoomChannelStatus = "ready" | "failed";

export type RoomChannelHandlers = {
  onInsert(row: MessageRow): void;
  /** `ready` once inserts are being delivered; `failed` when the channel will deliver no more. */
  onStatus(status: RoomChannelStatus): void;
};

/** The `system` message Realtime sends once an extension of a joined channel is running. */
type SystemPayload = { extension?: string; status?: string };

// The client reuses a channel whose topic is already open, so each subscription gets its own.
let channelCount = 0;

/**
 * Delivers every new message in one room until the returned function is called. Rows arrive as
 * Postgres sent them; callers check them, since nothing here vouches for their shape.
 *
 * `ready` waits for Realtime's own word that it is watching the table, not for the channel's
 * `SUBSCRIBED`: on a cold start `SUBSCRIBED` came about 2 s earlier, and a message posted in
 * between was never delivered, so a catch-up run at `SUBSCRIBED` could miss it for good.
 */
export function subscribeToRoomMessages(
  client: SupabaseClient,
  roomId: string,
  handlers: RoomChannelHandlers,
): () => void {
  let unsubscribed = false;
  let failed = false;
  function fail(): void {
    if (unsubscribed || failed) return;
    failed = true;
    handlers.onStatus("failed");
  }

  const channel = client
    .channel(`room-messages:${roomId}:${++channelCount}`)
    .on<MessageRow>(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (payload) => handlers.onInsert(payload.new),
    )
    .on("system", {}, (payload: SystemPayload) => {
      if (unsubscribed || failed || payload.extension !== "postgres_changes") return;
      if (payload.status === "ok") handlers.onStatus("ready");
      else fail();
    })
    .subscribe((status) => {
      // SUBSCRIBED only means the channel joined; the system message above reports readiness.
      if (status !== "SUBSCRIBED") fail();
    });

  return () => {
    unsubscribed = true;
    void client.removeChannel(channel);
  };
}
