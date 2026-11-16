"use client";

import { useNotifyEnabled, notificationsBlocked } from "@/hooks/useNotifyPreference";
import { useRoom } from "@/hooks/useRoom";
import { getDing } from "@/lib/ding";
import { getNotifyPreference } from "@/lib/notify-preference";

export const NOTIFY_ON_LABEL = "Turn on notifications";
export const NOTIFY_OFF_LABEL = "Turn off notifications";
export const NOTIFY_BLOCKED_HINT = "Notifications are blocked in your browser's settings. You'll still hear the ding.";

async function turnOn(): Promise<void> {
  // Both need this click: browsers start audio and ask for permission only after the user acts.
  getDing().unlock();
  const preference = getNotifyPreference();
  preference.set(true);
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // Old Safari takes a callback and returns nothing; the permission is then read on the next render.
  }
  // Renders again with the answer, so a refusal shows the hint at once.
  preference.set(true);
}

function BellIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
  );
}

/**
 * The bell that turns new-message alerts on or off for this browser, in every room. Only for a
 * room that exists, signed in or not: reading needs no account.
 */
export function NotifyToggle({ roomId, className = "" }: { roomId: string; className?: string }) {
  const { data: room } = useRoom(roomId);
  const enabled = useNotifyEnabled();
  if (!room) return null;
  const label = enabled ? NOTIFY_OFF_LABEL : NOTIFY_ON_LABEL;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => (enabled ? getNotifyPreference().set(false) : void turnOn())}
      className={`size-11 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10 ${className}`}
    >
      <BellIcon on={enabled} />
    </button>
  );
}

/** Says that turned-on alerts will only ding, where the browser shows no notifications. */
export function NotifyBlockedHint() {
  const enabled = useNotifyEnabled();
  if (!enabled || !notificationsBlocked()) return null;
  return <p role="status" className="shrink-0 text-center text-xs text-foreground/70">{NOTIFY_BLOCKED_HINT}</p>;
}
