/** A pin dropped on the map but not saved: nothing exists on the server until its first message. */
export type Draft = {
  id: string;
  lat: number;
  lng: number;
  /**
   * The draft closed an open room, adding a history entry for the map with no room. Saving replaces
   * that entry, so Back returns to the previous room rather than to a draft that is gone.
   */
  openedOverRoom: boolean;
  /** The room it became, until the panel has switched to that room. */
  savedAs?: string;
};

/** The longitude a pin was clicked at, possibly on a repeated copy of the world. */
export type PinAnchor = { roomId: string; lng: number };

export type DraftState = {
  draft: Draft | null;
  /** Where the newest pin, draft or room, was clicked. */
  pinAnchor: PinAnchor | null;
  /** Drafts started so far, which numbers their ids. */
  started: number;
};

export type DraftAction =
  /** A click or Enter on the map: starts a draft there, or moves the open one. */
  | { type: "start"; lat: number; lng: number; roomWasOpen: boolean }
  /** The draft's first message created `roomId`. */
  | { type: "created"; roomId: string; clickedLng: number; userMovedOn: boolean }
  /** Discarded, replaced by a picked room, ended by Back or Forward, or saved and shown. */
  | { type: "end" };

export const INITIAL_DRAFT_STATE: DraftState = { draft: null, pinAnchor: null, started: 0 };

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "start": {
      const started = state.started + 1;
      const id = `draft-${started}`;
      // Moving a draft adds no history entry, so it still owns the one it started with.
      const openedOverRoom = action.roomWasOpen || (state.draft?.openedOverRoom ?? false);
      return {
        started,
        draft: { id, lat: action.lat, lng: action.lng, openedOverRoom },
        pinAnchor: { roomId: id, lng: action.lng },
      };
    }
    case "created":
      return {
        ...state,
        pinAnchor: { roomId: action.roomId, lng: action.clickedLng },
        // Kept until the panel sees the new selection: clearing it now would drop the sheet for a
        // frame, because Next.js applies `?room` in a transition.
        draft: action.userMovedOn || !state.draft ? null : { ...state.draft, savedAs: action.roomId },
      };
    case "end":
      return state.draft === null ? state : { ...state, draft: null };
  }
}
