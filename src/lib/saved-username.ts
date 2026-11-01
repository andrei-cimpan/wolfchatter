import { AUTHOR_MAX } from "./limits";

const KEY = "wolfchatter.username";

// The window check comes first because Node has a `localStorage` global of its own, which warns
// when touched. The try blocks are for browsers that block storage, where even reading the
// property can throw: the username then lasts until the page is reloaded.

export function readSavedUsername(): string {
  if (typeof window === "undefined") return "";
  try {
    const saved = window.localStorage.getItem(KEY) ?? "";
    // The field's maxLength does not apply to a value set from code.
    return saved.length > AUTHOR_MAX ? "" : saved;
  } catch {
    return "";
  }
}

export function saveUsername(username: string): void {
  if (typeof window === "undefined") return;
  try {
    if (username === "") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, username);
  } catch {
    // Nothing to do: the username is still in the panel's state.
  }
}
