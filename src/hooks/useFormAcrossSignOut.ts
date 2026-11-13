"use client";

import { useState } from "react";
import type { CurrentUser } from "./useCurrentUser";

type Status = CurrentUser["status"];

/**
 * Whether a form stays on screen. A session usually ends by an event, such as another tab signing
 * out or a refresh that failed, while someone may be typing; swapping the form for the sign-in
 * prompt then would throw their text away. So a form with text stays until it is empty or the user
 * is signed in again.
 */
export function keepFormAfter({ from, to, hasText, kept }: { from: Status; to: Status; hasText: boolean; kept: boolean }) {
  if (to !== "signedOut" || !hasText) return false;
  return kept || from === "signedIn";
}

/** The form's state across sign-out: show it, and whether its session has ended under it. */
export function useFormAcrossSignOut(status: Status) {
  const [hasText, setHasText] = useState(false);
  const [previous, setPrevious] = useState(status);
  const [kept, setKept] = useState(false);
  // Worked out during render, so the form is never unmounted for a frame in between.
  const nextKept = keepFormAfter({ from: previous, to: status, hasText, kept });
  if (previous !== status) setPrevious(status);
  if (nextKept !== kept) setKept(nextKept);
  return {
    showForm: status === "signedIn" || nextKept,
    sessionEnded: nextKept,
    onHasTextChange: setHasText,
  };
}
