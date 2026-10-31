import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { createRoomErrorMessage } from "./useCreateRoom";

describe("createRoomErrorMessage", () => {
  it("says how long to wait after a 429", () => {
    const error = new ApiError(429, "rate_limited", "Too many requests", 42);
    expect(createRoomErrorMessage(error)).toBe(
      "You're creating chatrooms too quickly. Try again in 42 seconds.",
    );
  });

  it("uses the singular for one second", () => {
    const error = new ApiError(429, "rate_limited", "Too many requests", 1);
    expect(createRoomErrorMessage(error)).toMatch(/in 1 second\.$/);
  });

  it("falls back to a minute when the wait is unknown", () => {
    const error = new ApiError(429, "rate_limited", "Too many requests");
    expect(createRoomErrorMessage(error)).toMatch(/in a minute\.$/);
  });

  it("gives a generic message for anything else, without server details", () => {
    expect(createRoomErrorMessage(new ApiError(500, "internal_error", "boom"))).toBe(
      "Couldn't create the chatroom. Please try again.",
    );
    expect(createRoomErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Couldn't create the chatroom. Please try again.",
    );
  });
});
