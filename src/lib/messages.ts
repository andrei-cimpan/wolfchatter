import type { Message } from "./types";

/**
 * Adds the incoming messages that are not in the list yet, after the ones it already has.
 * The list keeps the server's order rather than re-sorting by `createdAt`: the API's timestamps
 * stop at milliseconds while Postgres orders by microseconds, so a sort here could swap two
 * messages sent within the same millisecond.
 */
export function mergeMessages(existing: readonly Message[], incoming: readonly Message[]): Message[] {
  const seen = new Set(existing.map((message) => message.id));
  const added = incoming.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  return [...existing, ...added];
}

/**
 * Merges a catch-up page (every message after `cursorId`, in server order) into the list. The page
 * replaces what the list holds after the cursor, so messages it fills in land in their place rather
 * than after live ones that arrived first; listed messages missing from the page arrived after it
 * was read, and stay at the end. The list is in arrival order, which can differ from the server's
 * just before the cursor too (a late commit), so a page message listed there moves to the page's
 * place. Without a cursor in the list, the page is merged as usual.
 */
export function mergeCaughtUp(
  existing: readonly Message[],
  cursorId: string | undefined,
  page: readonly Message[],
): Message[] {
  const cut = cursorId === undefined ? 0 : existing.findIndex((message) => message.id === cursorId) + 1;
  if (cursorId !== undefined && cut === 0) return mergeMessages(existing, page);
  const inPage = new Set(page.map((message) => message.id));
  const head = existing.slice(0, cut).filter((message) => !inPage.has(message.id));
  return [...head, ...mergeMessages(page, existing.slice(cut))];
}

/** Date and time in the reader's locale and time zone; the options exist for tests. */
export function formatMessageTime(iso: string, options: { locale?: string; timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: options.timeZone,
  }).format(new Date(iso));
}
