import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { messageInputError, postMessageErrorMessage } from "./useMessages";

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
