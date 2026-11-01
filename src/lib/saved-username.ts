import { postMessageSchema } from "./schemas";

const KEY = "wolfchatter.username";

/** The name as the API would store it, or "" if it could not be posted, so a blank one never comes back. */
function postableUsername(text: string): string {
  const result = postMessageSchema.shape.author.safeParse(text);
  return result.success ? result.data : "";
}

// The try blocks cover the server, which has no `window`, and browsers that block storage, where
// even reading the property can throw: the username then lasts until the page is reloaded.

export function readSavedUsername(): string {
  try {
    return postableUsername(window.localStorage.getItem(KEY) ?? "");
  } catch {
    return "";
  }
}

export function saveUsername(username: string): void {
  try {
    const name = postableUsername(username);
    if (name === "") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, name);
  } catch {
    // Nothing to do: the username is still in the panel's state.
  }
}
