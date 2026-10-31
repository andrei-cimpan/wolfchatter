"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiError, listMessages, postMessage, retryAfterPhrase } from "@/lib/api-client";
import { mergeMessages } from "@/lib/messages";
import { postMessageSchema } from "@/lib/schemas";
import type { Message } from "@/lib/types";
import { shouldRetryRoomQuery } from "./useRoom";

export function messagesQueryKey(roomId: string) {
  return ["messages", roomId] as const;
}

/**
 * The room's latest page of messages, oldest first. Until the live stream (T4) exists, the
 * default staleTime of 0 refetches it when the window regains focus or the room is reopened.
 */
export function useMessages(roomId: string) {
  return useQuery({
    queryKey: messagesQueryKey(roomId),
    queryFn: () => listMessages(roomId),
    retry: shouldRetryRoomQuery,
  });
}

/** Adds a message this tab posted to its room's cached list. */
export function addPostedMessage(queryClient: QueryClient, message: Message): void {
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

type PostMessageVariables = { roomId: string; author: string; body: string };

/** What is wrong with the form's input before it is sent, or `null` when it can be posted. */
export function messageInputError(author: string, body: string): string | null {
  const result = postMessageSchema.safeParse({ author, body });
  if (result.success) return null;
  return result.error.issues[0]?.path[0] === "author" ? "Enter a username." : "Enter a message.";
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
    onSuccess: (message) => addPostedMessage(queryClient, message),
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

  return { send, isPending: mutation.isPending, error: mutation.error };
}

export function postMessageErrorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return `You're sending messages too quickly. Try again ${retryAfterPhrase(error)}.`;
    if (error.status === 404) return "This chatroom no longer exists.";
    if (error.status === 400) return "Enter a username and a message.";
  }
  return "Couldn't send your message. Please try again.";
}
