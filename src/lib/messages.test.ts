import { describe, expect, it } from "vitest";
import { formatMessageTime, isNearBottom, mergeCaughtUp, mergeMessages, NEAR_BOTTOM_PX } from "./messages";
import type { Message } from "./types";

function message(id: string, createdAt = "2026-10-31T12:00:00.000Z"): Message {
  return { id, roomId: "room", author: "ana", body: `body ${id}`, createdAt };
}

describe("isNearBottom", () => {
  const atDistance = (distance: number) => ({ scrollHeight: 1000, clientHeight: 200, scrollTop: 800 - distance });

  it("is true at the very bottom", () => {
    expect(isNearBottom(atDistance(0))).toBe(true);
  });

  it("allows some slack, up to and including the limit", () => {
    expect(isNearBottom(atDistance(0.5))).toBe(true);
    expect(isNearBottom(atDistance(NEAR_BOTTOM_PX))).toBe(true);
  });

  it("is false once the reader has scrolled further up", () => {
    expect(isNearBottom(atDistance(NEAR_BOTTOM_PX + 1))).toBe(false);
    expect(isNearBottom(atDistance(800))).toBe(false);
  });

  it("is true when the content does not overflow", () => {
    expect(isNearBottom({ scrollHeight: 200, clientHeight: 200, scrollTop: 0 })).toBe(true);
  });
});

describe("mergeMessages", () => {
  it("appends new messages after the existing ones", () => {
    const merged = mergeMessages([message("a"), message("b")], [message("c")]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("skips messages it already has, including repeats within the incoming list", () => {
    const merged = mergeMessages([message("a"), message("b")], [message("b"), message("c"), message("c")]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the server's order for messages with the same timestamp", () => {
    // Postgres ordered these by microseconds that the API's millisecond timestamps drop.
    const merged = mergeMessages([message("z"), message("a")], [message("m")]);
    expect(merged.map((m) => m.id)).toEqual(["z", "a", "m"]);
  });

  it("does not change the list it was given", () => {
    const existing = [message("a")];
    mergeMessages(existing, [message("b")]);
    expect(existing.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("mergeCaughtUp", () => {
  const ids = (messages: Message[]) => messages.map((m) => m.id);

  it("adds the missed messages after the cursor, without repeating the overlap", () => {
    const merged = mergeCaughtUp([message("a"), message("b"), message("c")], "a", [message("b"), message("c"), message("d")]);
    expect(ids(merged)).toEqual(["a", "b", "c", "d"]);
  });

  it("puts missed messages before live ones that arrived while the page loaded", () => {
    // "e" came live before the page answered; "c" and "d" were sent during the gap.
    const merged = mergeCaughtUp([message("a"), message("b"), message("e")], "a", [message("b"), message("c"), message("d")]);
    expect(ids(merged)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("takes the server's order for a message that committed late", () => {
    // "x" committed after "c" was delivered live, but sorts before it.
    const merged = mergeCaughtUp([message("a"), message("c")], "a", [message("x"), message("c")]);
    expect(ids(merged)).toEqual(["a", "x", "c"]);
  });

  it("does not repeat a message the list holds before the cursor in another order (review #1)", () => {
    // "C" began its transaction first but "X" committed first: the list got X then C live, while
    // the server sorts C before X, so the page after C still holds X.
    const listed = [message("m1"), message("X"), message("C"), message("m4"), message("m5")];
    const merged = mergeCaughtUp(listed, "C", [message("X"), message("m4"), message("m5"), message("m6")]);
    expect(ids(merged)).toEqual(["m1", "C", "X", "m4", "m5", "m6"]);
  });

  it("merges a latest page into a short list when there is no cursor", () => {
    const merged = mergeCaughtUp([message("a"), message("e")], undefined, [message("a"), message("b")]);
    expect(ids(merged)).toEqual(["a", "b", "e"]);
  });

  it("appends the page when the cursor is no longer in the list", () => {
    const merged = mergeCaughtUp([message("a"), message("b")], "gone", [message("b"), message("c")]);
    expect(ids(merged)).toEqual(["a", "b", "c"]);
  });
});

describe("formatMessageTime", () => {
  it("shows the date and time in the given locale and time zone", () => {
    const iso = "2026-02-01T09:05:00.000Z";
    expect(formatMessageTime(iso, { locale: "en-GB", timeZone: "UTC" })).toBe("01/02/2026, 09:05");
    expect(formatMessageTime(iso, { locale: "en-US", timeZone: "America/New_York" })).toMatch(
      /^2\/1\/26, 4:05\sAM$/,
    );
  });
});
