"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Lets a component render exactly what
 * the server did on its first client pass, even when the query cache already holds newer data
 * (another component, such as the map, may have fetched it before this one hydrated).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
