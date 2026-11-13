import { ApiError } from "./api-client";
import { hasVisibleText, postMessageSchema } from "./schemas";

// What the message form tells the writer: what is wrong with their input before it is sent, and
// what went wrong after.

// Signing in again leaves for Google's page, which nothing keeps typed text across.
export const SIGNED_OUT_MESSAGE = "You've been signed out. Signing in again clears this message, so copy it first.";

/** What is wrong with the message before it is sent, or `null` when it can be posted. */
export function messageInputError(body: string): string | null {
  const result = postMessageSchema.safeParse({ body });
  if (result.success) return null;
  const [issue] = result.error.issues;
  // Text that looks fine but is refused, such as a pasted NUL: "Enter a message." beside it would
  // make no sense, so the schema's own message is shown.
  if (!issue || !hasVisibleText(body)) return "Enter a message.";
  return issue.message;
}

/** A post or room creation refused because the session has ended. */
export function isSignedOutError(error: Error): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function postMessageErrorMessage(error: Error): string {
  if (isSignedOutError(error)) return SIGNED_OUT_MESSAGE;
  if (error instanceof ApiError) {
    if (error.status === 404) return "This chatroom no longer exists.";
    if (error.status === 400) return "Enter a message.";
  }
  return "Couldn't send your message. Please try again.";
}

export function createRoomErrorMessage(error: Error): string {
  if (isSignedOutError(error)) return SIGNED_OUT_MESSAGE;
  return "Couldn't create the chatroom. Please try again.";
}
