import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { createRoomErrorMessage, messageInputError, postMessageErrorMessage } from "./message-input";

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

  it("says what is wrong when a field has text the API would refuse", () => {
    expect(messageInputError("ana", "hello\u0000there")).toBe("Message contains invalid characters");
    expect(messageInputError("an\u0000a", "Hello")).toBe("Username contains invalid characters");
  });

  it("still asks for the text when a field holds only a NUL", () => {
    expect(messageInputError("ana", "\u0000")).toBe("Enter a message.");
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
