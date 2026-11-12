"use client";

import { signOut } from "@/lib/supabase/auth";

/** Whose name a post goes out under, right above the form, with the way out. */
export function PostingAs({ name }: { name: string }) {
  return (
    <p className="mt-4 flex shrink-0 items-center justify-between gap-2 text-sm text-foreground/70">
      <span>
        Posting as <span className="font-medium text-foreground">{name}</span>
      </span>
      <button type="button" onClick={() => void signOut()} className="h-11 rounded px-2 underline hover:bg-foreground/10">
        Sign out
      </button>
    </p>
  );
}
