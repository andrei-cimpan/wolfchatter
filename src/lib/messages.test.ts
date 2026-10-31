import { describe, expect, it } from "vitest";
import { formatMessageTime, mergeMessages } from "./messages";
import type { Message } from "./types";

function message(id: string, createdAt = "2026-10-31T12:00:00.000Z"): Message {
  return { id, roomId: "room", author: "ana", body: `body ${id}`, createdAt };
}

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

describe("formatMessageTime", () => {
  it("shows the date and time in the given locale and time zone", () => {
    const iso = "2026-02-01T09:05:00.000Z";
    expect(formatMessageTime(iso, { locale: "en-GB", timeZone: "UTC" })).toBe("01/02/2026, 09:05");
    expect(formatMessageTime(iso, { locale: "en-US", timeZone: "America/New_York" })).toMatch(
      /^2\/1\/26, 4:05\sAM$/,
    );
  });
});
