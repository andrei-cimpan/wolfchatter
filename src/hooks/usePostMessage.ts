"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { postMessage } from "@/lib/api-client";
import { addMessage } from "@/lib/message-cache";

type PostMessageVariables = { roomId: string; author: string; body: string };

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
