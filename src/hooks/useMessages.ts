"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiError, listMessages, postMessage, retryAfterPhrase } from "@/lib/api-client";
import { MESSAGE_LIMIT_MAX } from "@/lib/limits";
import { mergeCaughtUp, mergeMessages } from "@/lib/messages";
import { hasVisibleText, postMessageSchema } from "@/lib/schemas";
import type { Message } from "@/lib/types";
import { shouldRetryRoomQuery } from "./useRoom";

export function messagesQueryKey(roomId: string) {
  return ["messages", roomId] as const;
}

/**
 * The room's latest page of messages, oldest first. The live stream (`useRoomStream`) adds new
 * ones; the default staleTime of 0 still refetches it when the window regains focus or the room is
 * reopened, which covers a stream that keeps failing.
 */
export function useMessages(roomId: string) {
  return useQuery({
    queryKey: messagesQueryKey(roomId),
    queryFn: () => listMessages(roomId),
    retry: shouldRetryRoomQuery,
  });
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

type PostMessageVariables = { roomId: string; author: string; body: string };

/** What is wrong with the form's input before it is sent, or `null` when it can be posted. */
export function messageInputError(author: string, body: string): string | null {
  const result = postMessageSchema.safeParse({ author, body });
  if (result.success) return null;
  const [issue] = result.error.issues;
  const isAuthor = issue?.path[0] === "author";
  if (!issue || !hasVisibleText(isAuthor ? author : body)) return isAuthor ? "Enter a username." : "Enter a message.";
  // Text that looks fine but is refused, such as a pasted NUL: "Enter a message." beside it would
  // make no sense. The form calls the API's author a username.
  return issue.message.replace(/^Author/, "Username");
}

/**
 * Posts to a room and adds the stored message to that room's list (keyed by the message's own
 * room). The cache update is hook-level, so it still lands if the user switches rooms first.
 */
export function usePostMessage(roomId: string) {
  const queryClient = useQueryClient();
  // A ref, not `isPending`: a second Enter can land before React re-renders with the new state.
  const sendingRef = useRef(false);

  const mutation = useMutation({
    mutationFn: ({ roomId: id, author, body }: PostMessageVariables) => postMessage(id, { author, body }),
    onSuccess: (message) => addMessage(queryClient, message),
    onSettled: () => {
      sendingRef.current = false;
    },
  });

  /** Sends the message unless one is already on its way; `onSent` runs only while still mounted. */
  function send(author: string, body: string, onSent: () => void) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    mutation.mutate({ roomId, author, body }, { onSuccess: onSent });
  }

  /** Forgets the last failure. Not while sending: a reset would drop that post's `onSent`. */
  function clearError() {
    if (!sendingRef.current) mutation.reset();
  }

  return { send, clearError, isPending: mutation.isPending, error: mutation.error };
}

export function postMessageErrorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return `You're sending messages too quickly. Try again ${retryAfterPhrase(error)}.`;
    if (error.status === 404) return "This chatroom no longer exists.";
    if (error.status === 400) return "Enter a username and a message.";
  }
  return "Couldn't send your message. Please try again.";
}
