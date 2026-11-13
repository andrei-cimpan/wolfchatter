"use client";

import { useState } from "react";
import { signOut } from "@/lib/supabase/auth";

/** Whose name a post goes out under, right above the form, with the way out. */
export function PostingAs({ name }: { name: string }) {
  // Offline, signing out fails and the session stays; without a word the button would seem broken.
  const [failed, setFailed] = useState(false);
  async function handleSignOut() {
    setFailed(false);
    try {
      await signOut();
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="mt-4 flex shrink-0 flex-col gap-1">
      <p className="flex items-center justify-between gap-2 text-sm text-foreground/70">
        <span>
          Posting as <span className="font-medium text-foreground">{name}</span>
        </span>
        <button type="button" onClick={() => void handleSignOut()} className="h-11 rounded px-2 underline hover:bg-foreground/10">
          Sign out
        </button>
      </p>
      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Couldn&apos;t sign out. Please try again.
        </p>
      )}
    </div>
  );
}
