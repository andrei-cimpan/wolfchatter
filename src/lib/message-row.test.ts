import { describe, expect, it } from "vitest";
import { messageFromRow } from "./message-row";

const row = {
  id: "5d7c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
  room_id: "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a",
  author: "ana",
  body: "Hello",
};

describe("messageFromRow", () => {
  it("renames the columns to the API's fields", () => {
    expect(messageFromRow({ ...row, created_at: new Date("2026-11-03T10:00:00.123Z") })).toEqual({
      id: row.id,
      roomId: row.room_id,
      author: "ana",
      body: "Hello",
      createdAt: "2026-11-03T10:00:00.123Z",
    });
  });

  it("gives a NOTIFY timestamp the same shape as a queried one", () => {
    const fromNotify = messageFromRow({ ...row, created_at: "2026-11-03T12:00:00.123456+02:00" });
    const fromQuery = messageFromRow({ ...row, created_at: new Date("2026-11-03T10:00:00.123Z") });
    expect(fromNotify).toEqual(fromQuery);
  });

  it("reads the timestamp text PostgREST and Realtime send", () => {
    expect(messageFromRow({ ...row, created_at: "2026-11-03T10:00:00.123456+00:00" }).createdAt).toBe(
      "2026-11-03T10:00:00.123Z",
    );
    expect(messageFromRow({ ...row, created_at: "2026-11-03 10:00:00.123456+00" }).createdAt).toBe(
      "2026-11-03T10:00:00.123Z",
    );
  });
});
