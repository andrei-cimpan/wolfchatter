import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { Message } from "@/lib/types";
import { addPostedMessage, messageInputError, messagesQueryKey, postMessageErrorMessage } from "./useMessages";

describe("messageInputError", () => {
  it("accepts a username and a message with visible text", () => {
    expect(messageInputError("ana", "Hello")).toBeNull();
  });

  it("asks for a username when it is blank or invisible", () => {
    expect(messageInputError("", "Hello")).toBe("Enter a username.");
    expect(messageInputError(" ​ ", "Hello")).toBe("Enter a username.");
  });

  it("asks for a message when it is blank or invisible", () => {
    expect(messageInputError("ana", "   ")).toBe("Enter a message.");
    expect(messageInputError("ana", "ㅤ")).toBe("Enter a message.");
  });
});

describe("postMessageErrorMessage", () => {
  it("says how long to wait after a 429", () => {
    expect(postMessageErrorMessage(new ApiError(429, "rate_limited", "x", 12))).toBe(
      "You're sending messages too quickly. Try again in 12 seconds.",
    );
    expect(postMessageErrorMessage(new ApiError(429, "rate_limited", "x"))).toBe(
      "You're sending messages too quickly. Try again in a minute.",
    );
  });

  it("explains a room that no longer exists", () => {
    expect(postMessageErrorMessage(new ApiError(404, "room_not_found", "x"))).toBe("This chatroom no longer exists.");
  });

  it("asks for both fields when the API rejects the input", () => {
    expect(postMessageErrorMessage(new ApiError(400, "validation_error", "author: x"))).toBe(
      "Enter a username and a message.",
    );
  });

  it("falls back to a generic message for server and network errors", () => {
    expect(postMessageErrorMessage(new ApiError(500, "internal_error", "x"))).toBe(
      "Couldn't send your message. Please try again.",
    );
    expect(postMessageErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Couldn't send your message. Please try again.",
    );
  });
});

describe("addPostedMessage", () => {
  const ROOM = "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a";
  const message = (id: string): Message => ({ id, roomId: ROOM, author: "ana", body: id, createdAt: "2026-10-31T12:00:00.000Z" });

  /** A cache whose messages query is active, as it is while the room's list is on screen. */
  function watchedClient(fetchMessages: () => Promise<Message[]>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, { queryKey: messagesQueryKey(ROOM), queryFn: fetchMessages });
    const unsubscribe = observer.subscribe(() => {});
    return { client, unsubscribe };
  }

  it("adds the message to a list that has loaded", () => {
    const client = new QueryClient();
    client.setQueryData(messagesQueryKey(ROOM), [message("a")]);
    addPostedMessage(client, message("b"));
    expect(client.getQueryData<Message[]>(messagesQueryKey(ROOM))?.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("loads a list that never loaded, message included", async () => {
    let calls = 0;
    const { client, unsubscribe } = watchedClient(async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return [message("a"), message("b")];
    });
    await vi.waitFor(() => expect(client.getQueryState(messagesQueryKey(ROOM))?.status).toBe("error"));

    addPostedMessage(client, message("b"));
    await vi.waitFor(() =>
      expect(client.getQueryData<Message[]>(messagesQueryKey(ROOM))?.map((m) => m.id)).toEqual(["a", "b"]),
    );
    unsubscribe();
  });

  it("keeps the message when a fetch that started before the post resolves after it", async () => {
    const pending: ((messages: Message[]) => void)[] = [];
    const { client, unsubscribe } = watchedClient(
      () => new Promise<Message[]>((resolve) => pending.push(resolve)),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()?.([message("a")]);
    await vi.waitFor(() => expect(client.getQueryData(messagesQueryKey(ROOM))).toBeDefined());

    // A refetch (window focus, say) is on its way, and its answer predates the post.
    void client.refetchQueries({ queryKey: messagesQueryKey(ROOM) });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    addPostedMessage(client, message("b"));
    pending.shift()?.([message("a")]);

    // The post's refetch replaced the stale one; it answers with the message included.
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()?.([message("a"), message("b")]);
    await vi.waitFor(() =>
      expect(client.getQueryData<Message[]>(messagesQueryKey(ROOM))?.map((m) => m.id)).toEqual(["a", "b"]),
    );
    unsubscribe();
  });
});
