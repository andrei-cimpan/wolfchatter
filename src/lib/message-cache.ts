import type { QueryClient } from "@tanstack/react-query";
import { listMessages } from "./api-client";
import { MESSAGE_LIMIT_MAX } from "./limits";
import { mergeCaughtUp, mergeMessages } from "./messages";
import type { Message } from "./types";

// How a room's cached message list is keyed and kept up to date: by this tab's posts, live
// messages, and catch-up after the stream reconnects.

export function messagesQueryKey(roomId: string) {
  return ["messages", roomId] as const;
}

/** Adds a message (one this tab posted, or a live one) to its room's cached list. */
export function addMessage(queryClient: QueryClient, message: Message): void {
  const key = messagesQueryKey(message.roomId);
  if (queryClient.getQueryData<Message[]>(key) !== undefined) {
    queryClient.setQueryData<Message[]>(key, (messages) => mergeMessages(messages ?? [], [message]));
  }
  // A list that never loaded has nothing to add to, and a fetch that started before the post
  // committed would overwrite the list without it; refetching (which cancels that fetch) covers both.
  if (queryClient.getQueryData(key) === undefined || queryClient.isFetching({ queryKey: key }) > 0) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

// Messages before the last one seen that catch-up asks for again. created_at is the inserting
// transaction's start, so a message can commit after a newer one yet sort before it; asking only
// for what follows the last one seen would skip it for good.
export const CATCH_UP_OVERLAP = 5;

/**
 * Fills in what the room's list missed while its stream was not subscribed: run on every `ready`,
 * the first one included, since the list's first fetch may have started before the subscribe.
 */
export async function catchUp(queryClient: QueryClient, roomId: string): Promise<void> {
  const key = messagesQueryKey(roomId);
  // A fetch on its way may predate the subscribe; catch up from its answer rather than restart it.
  // A list that never loaded is fetched now, which needs no catching up but does no harm.
  if (queryClient.getQueryData(key) === undefined || queryClient.isFetching({ queryKey: key }) > 0) {
    await queryClient.refetchQueries({ queryKey: key }, { cancelRefetch: false });
  }
  const messages = queryClient.getQueryData<Message[]>(key);
  // Still not loaded: the list shows its error and a way to try again.
  if (messages === undefined) return;

  // With too few messages for the overlap, the latest page covers the whole gap.
  const cursor = messages.at(-1 - CATCH_UP_OVERLAP)?.id;
  let page: Message[];
  try {
    page = await listMessages(roomId, { after: cursor, limit: MESSAGE_LIMIT_MAX });
  } catch {
    return void queryClient.invalidateQueries({ queryKey: key });
  }
  // A full page may not reach the newest message. The list shows only the latest page, so load
  // that instead of paging through the gap.
  if (page.length === MESSAGE_LIMIT_MAX) return void queryClient.invalidateQueries({ queryKey: key });
  queryClient.setQueryData<Message[]>(key, (current) => current && mergeCaughtUp(current, cursor, page));
}
