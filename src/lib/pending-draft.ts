/**
 * A draft pin's position, kept across the trip to Google's sign-in page: the page unloads, and the
 * draft lives only in React state. sessionStorage, so it stays with this tab and goes when it closes.
 */
export const PENDING_DRAFT_KEY = "wolfchatter:pending-draft";

export type DraftPosition = { lat: number; lng: number };

function isPosition(value: unknown): value is DraftPosition {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

// Storage can be blocked or full. Losing the pin is better than breaking sign-in or the page.
export function savePendingDraft(storage: Storage, position: DraftPosition): void {
  try {
    storage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ lat: position.lat, lng: position.lng }));
  } catch {
    // Nothing to keep it in.
  }
}

/** The saved position, once: it is removed as it is read, so a second reload starts empty. */
export function takePendingDraft(storage: Storage): DraftPosition | null {
  try {
    const raw = storage.getItem(PENDING_DRAFT_KEY);
    if (raw === null) return null;
    storage.removeItem(PENDING_DRAFT_KEY);
    const value: unknown = JSON.parse(raw);
    return isPosition(value) ? { lat: value.lat, lng: value.lng } : null;
  } catch {
    return null;
  }
}
