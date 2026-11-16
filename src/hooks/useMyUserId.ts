"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser-client";

/**
 * The signed-in user's id from the browser's own session, or null. It only tells a tab which live
 * messages are its user's own, so they raise no alert: a stale id costs a missed or extra ding at
 * most, which is why the session is enough and `/api/me` needs no id. `INITIAL_SESSION` fires on
 * subscribe, so the id is known from the first render after load.
 */
export function useMyUserId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const { data } = getBrowserSupabase().auth.onAuthStateChange((_event, session) => {
      setId(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return id;
}
