import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { createRoomErrorMessage, isSignedOutError, messageInputError, postMessageErrorMessage } from "./message-input";

const SIGNED_OUT = "You've been signed out. Signing in again clears this message, so copy it first.";

describe("messageInputError", () => {
  it("accepts a message with visible text", () => {
    expect(messageInputError("Hello")).toBeNull();
  });

  it("asks for a message when it is blank or invisible", () => {
    expect(messageInputError("")).toBe("Enter a message.");
    expect(messageInputError("   ")).toBe("Enter a message.");
    expect(messageInputError("ㅤ")).toBe("Enter a message.");
  });

  it("says what is wrong when the text is something the API would refuse", () => {
    expect(messageInputError("hello\u0000there")).toBe("Message contains invalid characters");
  });

  it("still asks for the text when it holds only a NUL", () => {
    expect(messageInputError("\u0000")).toBe("Enter a message.");
  });
});

describe("isSignedOutError", () => {
  it("is true only for a 401", () => {
    expect(isSignedOutError(new ApiError(401, "unauthenticated", "x"))).toBe(true);
    expect(isSignedOutError(new ApiError(404, "room_not_found", "x"))).toBe(false);
    expect(isSignedOutError(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("postMessageErrorMessage", () => {
  // Signing in leaves the page for Google, and nothing keeps typed text across that.
  it("explains a session that ended, and that signing in loses the text", () => {
    expect(postMessageErrorMessage(new ApiError(401, "unauthenticated", ""))).toBe(SIGNED_OUT);
  });

  it("explains a room that no longer exists", () => {
    expect(postMessageErrorMessage(new ApiError(404, "room_not_found", "x"))).toBe("This chatroom no longer exists.");
  });

  it("asks for a message when the API rejects the input", () => {
    expect(postMessageErrorMessage(new ApiError(400, "validation_error", "body: x"))).toBe("Enter a message.");
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
  it("explains a session that ended", () => {
    expect(createRoomErrorMessage(new ApiError(401, "unauthenticated", ""))).toBe(SIGNED_OUT);
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
