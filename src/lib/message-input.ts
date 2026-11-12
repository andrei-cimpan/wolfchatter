import { ApiError, retryAfterPhrase } from "./api-client";
import { hasVisibleText, postMessageSchema } from "./schemas";

// What the message form tells the writer: what is wrong with their input before it is sent, and
// what went wrong after.

/** What is wrong with the form's input before it is sent, or `null` when it can be posted. */
export function messageInputError(author: string, body: string): string | null {
  const result = postMessageSchema.safeParse({ author, body });
  if (result.success) return null;
  const [issue] = result.error.issues;
  const isAuthor = issue?.path[0] === "author";
  if (!issue || !hasVisibleText(isAuthor ? author : body)) return isAuthor ? "Enter a username." : "Enter a message.";
  // Text that looks fine but is refused, such as a pasted NUL: "Enter a message." beside it would
  // make no sense. The form calls the API's author a username.
  return issue.message.replace(/^Author/, "Username");
}

export function postMessageErrorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return `You're sending messages too quickly. Try again ${retryAfterPhrase(error)}.`;
    if (error.status === 404) return "This chatroom no longer exists.";
    if (error.status === 400) return "Enter a username and a message.";
  }
  return "Couldn't send your message. Please try again.";
}

export function createRoomErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 429) {
    return `You're creating chatrooms too quickly. Try again ${retryAfterPhrase(error)}.`;
  }
  return "Couldn't create the chatroom. Please try again.";
}
