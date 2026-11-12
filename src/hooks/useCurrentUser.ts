"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getMe } from "@/lib/api-client";
import { getBrowserSupabase } from "@/lib/supabase/browser-client";

export const ME_QUERY_KEY = ["me"] as const;

export type CurrentUser = { status: "loading" | "signedIn" | "signedOut"; name: string | null };

/** The query's state as the panel needs it. A failed /api/me reads as signed out. */
export function currentUserFrom(query: { isPending: boolean; data: { name: string | null } | undefined }): CurrentUser {
  if (query.isPending) return { status: "loading", name: null };
  const name = query.data?.name ?? null;
  return name === null ? { status: "signedOut", name: null } : { status: "signedIn", name };
}

/**
 * Who is signed in, from the server (`/api/me`), which also knows the name they post under. It is
 * asked again whenever the browser's session changes: sign-in, sign-out, or a session that ended.
 */
export function useCurrentUser(): CurrentUser {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: getMe, staleTime: Infinity, retry: 1 });
  useEffect(() => {
    const { data } = getBrowserSupabase().auth.onAuthStateChange((event) => {
      // Neither changes who is signed in, and the first fires on every page load.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);
  return currentUserFrom(query);
}
