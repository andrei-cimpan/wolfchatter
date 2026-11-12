"use client";

import { useMemo, useReducer } from "react";
import { draftReducer, INITIAL_DRAFT_STATE } from "@/lib/draft";

/** The draft pin and the newest pin's anchor; the transitions are `draftReducer`'s. */
export function useDraft() {
  const [{ draft, pinAnchor }, dispatch] = useReducer(draftReducer, INITIAL_DRAFT_STATE);
  // Stable, since `dispatch` is, so they can be passed down without new identities each render.
  const actions = useMemo(
    () => ({
      start: (lat: number, lng: number, roomWasOpen: boolean) => dispatch({ type: "start", lat, lng, roomWasOpen }),
      created: (roomId: string, clickedLng: number, userMovedOn: boolean) =>
        dispatch({ type: "created", roomId, clickedLng, userMovedOn }),
      end: () => dispatch({ type: "end" }),
    }),
    [],
  );
  return { draft, pinAnchor, ...actions };
}
