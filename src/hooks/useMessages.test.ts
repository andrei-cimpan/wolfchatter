import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { Message } from "@/lib/types";
import { MESSAGE_LIMIT_MAX } from "@/lib/limits";
import { addMessage, CATCH_UP_OVERLAP, catchUp, messageInputError, messagesQueryKey, postMessageErrorMessage } from "./useMessages";

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

describe("addMessage", () => {
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
    addMessage(client, message("b"));
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

    addMessage(client, message("b"));
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
    addMessage(client, message("b"));
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

describe("catchUp", () => {
  const ROOM = "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a";
  const message = (id: string): Message => ({ id, roomId: ROOM, author: "ana", body: id, createdAt: "2026-10-31T12:00:00.000Z" });
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => message(`m${from + i}`));
  const ids = (client: QueryClient) => client.getQueryData<Message[]>(messagesQueryKey(ROOM))?.map((m) => m.id);

  afterEach(() => vi.unstubAllGlobals());

  /** Answers catch-up requests (the API's `after=` page) with `page`, and records their URLs. */
  function stubCatchUp(page: Message[] | Error) {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return page instanceof Error ? Promise.reject(page) : Response.json(page);
      }),
    );
    return urls;
  }

  /** A watched list whose own fetches (first load and refetches) answer from `load`. */
  function watchedClient(load: () => Promise<Message[]>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, { queryKey: messagesQueryKey(ROOM), queryFn: load });
    const unsubscribe = observer.subscribe(() => {});
    return { client, unsubscribe };
  }

  async function loadedClient(messages: Message[], refetched: Message[] = messages) {
    let calls = 0;
    const load = vi.fn(async () => (calls++ === 0 ? messages : refetched));
    const watched = watchedClient(load);
    await vi.waitFor(() => expect(watched.client.getQueryData(messagesQueryKey(ROOM))).toBeDefined());
    return { ...watched, load };
  }

  it(`asks for what follows the message ${CATCH_UP_OVERLAP} before the last one, and adds what is new`, async () => {
    const { client, unsubscribe } = await loadedClient(range(1, 7));
    const urls = stubCatchUp(range(3, 9));
    await catchUp(client, ROOM);
    expect(urls).toEqual([`/api/rooms/${ROOM}/messages?after=m2&limit=${MESSAGE_LIMIT_MAX}`]);
    expect(ids(client)).toEqual(range(1, 9).map((m) => m.id));
    unsubscribe();
  });

  it("does not duplicate anything when nothing was missed", async () => {
    const { client, unsubscribe } = await loadedClient(range(1, 7));
    stubCatchUp(range(3, 7));
    await catchUp(client, ROOM);
    await catchUp(client, ROOM);
    expect(ids(client)).toEqual(range(1, 7).map((m) => m.id));
    unsubscribe();
  });

  it("asks for the latest page when the list is too short for the overlap", async () => {
    const { client, unsubscribe } = await loadedClient(range(1, CATCH_UP_OVERLAP));
    const urls = stubCatchUp(range(1, CATCH_UP_OVERLAP + 1));
    await catchUp(client, ROOM);
    expect(urls).toEqual([`/api/rooms/${ROOM}/messages?limit=${MESSAGE_LIMIT_MAX}`]);
    expect(ids(client)).toEqual(range(1, CATCH_UP_OVERLAP + 1).map((m) => m.id));
    unsubscribe();
  });

  it("keeps a live message that arrived while the catch-up page loaded after the missed ones", async () => {
    const { client, unsubscribe } = await loadedClient(range(1, 7));
    const page = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(() => page.promise));
    const caughtUp = catchUp(client, ROOM);
    addMessage(client, message("live"));
    page.resolve(Response.json(range(3, 9)));
    await caughtUp;
    expect(ids(client)).toEqual([...range(1, 9).map((m) => m.id), "live"]);
    unsubscribe();
  });

  it("reloads the latest page when the gap fills a whole page", async () => {
    const { client, unsubscribe, load } = await loadedClient(range(1, 7), range(200, 249));
    stubCatchUp(range(3, 2 + MESSAGE_LIMIT_MAX));
    await catchUp(client, ROOM);
    await vi.waitFor(() => expect(ids(client)).toEqual(range(200, 249).map((m) => m.id)));
    expect(load).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("reloads the list when the catch-up request fails", async () => {
    const { client, unsubscribe, load } = await loadedClient(range(1, 7), range(1, 8));
    stubCatchUp(new TypeError("Failed to fetch"));
    await catchUp(client, ROOM);
    await vi.waitFor(() => expect(ids(client)).toEqual(range(1, 8).map((m) => m.id)));
    expect(load).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("waits for a first load already on its way, then catches up from its answer", async () => {
    const pending: ((messages: Message[]) => void)[] = [];
    const load = vi.fn(() => new Promise<Message[]>((resolve) => pending.push(resolve)));
    const { client, unsubscribe } = watchedClient(load);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    stubCatchUp(range(3, 8));

    const caughtUp = catchUp(client, ROOM);
    pending.shift()?.(range(1, 7));
    await caughtUp;
    expect(load).toHaveBeenCalledOnce();
    expect(ids(client)).toEqual(range(1, 8).map((m) => m.id));
    unsubscribe();
  });

  it("leaves a list that cannot load to its own error state", async () => {
    const load = vi.fn(async (): Promise<Message[]> => {
      throw new Error("offline");
    });
    const { client, unsubscribe } = watchedClient(load);
    await vi.waitFor(() => expect(client.getQueryState(messagesQueryKey(ROOM))?.status).toBe("error"));
    const urls = stubCatchUp([]);
    await catchUp(client, ROOM);
    expect(urls).toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
