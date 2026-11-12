"use client";

import { useState } from "react";
import type { DraftPosition } from "@/lib/pending-draft";
import { signInWithGoogle } from "@/lib/supabase/auth";

/** Sends the user to Google's sign-in page; a draft's pin is kept for when they come back. */
export function SignInPrompt({ label, draft }: { label: string; draft?: DraftPosition }) {
  const [failed, setFailed] = useState(false);
  async function signIn() {
    setFailed(false);
    try {
      await signInWithGoogle({ draft });
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="mt-4 flex shrink-0 flex-col gap-2">
      <button
        type="button"
        onClick={() => void signIn()}
        className="h-11 rounded border border-foreground/30 px-4 font-medium hover:bg-foreground/10"
      >
        {label}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Couldn&apos;t open the sign-in page. Please try again.
        </p>
      )}
    </div>
  );
}
