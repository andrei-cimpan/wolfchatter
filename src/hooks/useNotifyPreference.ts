"use client";

import { useSyncExternalStore } from "react";
import { getNotifyPreference } from "@/lib/notify-preference";

const subscribe = (listener: () => void) => getNotifyPreference().subscribe(listener);

/** Whether this browser turned new-message alerts on. Off on the server and during hydration. */
export function useNotifyEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getNotifyPreference().get(),
    () => false,
  );
}

/**
 * Whether turned-on alerts can only ding: notifications are denied, or the browser has none
 * (Safari on an iPhone outside a web app on the home screen). Read on each render; the toggle sets
 * the preference again once the permission prompt is answered, which renders this again.
 */
export function notificationsBlocked(): boolean {
  return typeof Notification === "undefined" || Notification.permission === "denied";
}
