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

/** Date and time in the reader's locale and time zone; the options exist for tests. */
export function formatMessageTime(iso: string, options: { locale?: string; timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: options.timeZone,
  }).format(new Date(iso));
}
