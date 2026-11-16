export const NOTIFY_KEY = "wolfchatter:notify";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageEventTarget = {
  addEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
};

export type NotifyPreference = {
  get(): boolean;
  set(on: boolean): void;
  /** For `useSyncExternalStore`: calls back on a change in this tab or another. */
  subscribe(listener: () => void): () => void;
};

export type NotifyPreferenceOptions = {
  storage?: () => PreferenceStorage | null;
  target?: StorageEventTarget;
};

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Reading `localStorage` itself throws where the browser blocks storage.
    return null;
  }
}

/**
 * Whether this browser wants new-message alerts, for every room. Off unless turned on. Blocked
 * storage reads as off, and the toggle then lasts only as long as the page.
 */
export function createNotifyPreference({
  storage = browserStorage,
  target = typeof window === "undefined" ? undefined : window,
}: NotifyPreferenceOptions = {}): NotifyPreference {
  const listeners = new Set<() => void>();
  let unsaved: boolean | undefined;

  function read(): boolean {
    try {
      const stored = storage()?.getItem(NOTIFY_KEY);
      return stored === undefined || stored === null ? (unsaved ?? false) : stored === "on";
    } catch {
      return unsaved ?? false;
    }
  }

  function onStorage(event: { key: string | null }): void {
    if (event.key === NOTIFY_KEY || event.key === null) for (const listener of listeners) listener();
  }

  return {
    get: read,
    set(on) {
      try {
        const store = storage();
        if (on) store?.setItem(NOTIFY_KEY, "on");
        else store?.removeItem(NOTIFY_KEY);
        unsaved = store ? undefined : on;
      } catch {
        unsaved = on;
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      if (listeners.size === 0) target?.addEventListener("storage", onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) target?.removeEventListener("storage", onStorage);
      };
    },
  };
}

let shared: NotifyPreference | undefined;

export function getNotifyPreference(): NotifyPreference {
  return (shared ??= createNotifyPreference());
}
