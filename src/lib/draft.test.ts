import { describe, expect, it } from "vitest";
import { draftReducer, INITIAL_DRAFT_STATE, type DraftAction, type DraftState } from "./draft";

const start = (lat: number, lng: number, roomWasOpen = false): DraftAction => ({ type: "start", lat, lng, roomWasOpen });
const run = (...actions: DraftAction[]): DraftState => actions.reduce(draftReducer, INITIAL_DRAFT_STATE);

describe("draftReducer", () => {
  it("starts a draft where the map was clicked and anchors its pin there", () => {
    const state = run(start(48, 200));
    expect(state.draft).toEqual({ id: "draft-1", lat: 48, lng: 200, openedOverRoom: false });
    expect(state.pinAnchor).toEqual({ roomId: "draft-1", lng: 200 });
  });

  it("gives a moved draft a new id and anchor", () => {
    const state = run(start(48, 20), start(50, 22));
    expect(state.draft).toMatchObject({ id: "draft-2", lat: 50, lng: 22 });
    expect(state.pinAnchor).toEqual({ roomId: "draft-2", lng: 22 });
  });

  it("remembers that the draft closed a room, even after it moves", () => {
    expect(run(start(48, 20, true)).draft?.openedOverRoom).toBe(true);
    expect(run(start(48, 20, true), start(50, 22, false)).draft?.openedOverRoom).toBe(true);
    expect(run(start(48, 20, false), start(50, 22, false)).draft?.openedOverRoom).toBe(false);
  });

  it("does not carry openedOverRoom into a draft started after the last one ended", () => {
    expect(run(start(48, 20, true), { type: "end" }, start(50, 22)).draft?.openedOverRoom).toBe(false);
  });

  it("keeps a saved draft, marked with its room, until the panel has switched", () => {
    const state = run(start(48, 200), { type: "created", roomId: "room-1", clickedLng: 200, userMovedOn: false });
    expect(state.draft).toMatchObject({ id: "draft-1", savedAs: "room-1" });
    expect(state.pinAnchor).toEqual({ roomId: "room-1", lng: 200 });
  });

  it("drops the draft at once when the user moved on during the send, but anchors the new room", () => {
    const state = run(start(48, 200), { type: "end" }, { type: "created", roomId: "room-1", clickedLng: 200, userMovedOn: true });
    expect(state.draft).toBeNull();
    expect(state.pinAnchor).toEqual({ roomId: "room-1", lng: 200 });
  });

  it("drops the draft when told the user moved on, even if it is still there", () => {
    const state = run(start(48, 20), { type: "created", roomId: "room-1", clickedLng: 20, userMovedOn: true });
    expect(state.draft).toBeNull();
  });

  it("ends a draft and keeps the pin's anchor", () => {
    const state = run(start(48, 200), { type: "end" });
    expect(state.draft).toBeNull();
    expect(state.pinAnchor).toEqual({ roomId: "draft-1", lng: 200 });
  });

  it("returns the same state when there is no draft to end, so React skips the render", () => {
    expect(draftReducer(INITIAL_DRAFT_STATE, { type: "end" })).toBe(INITIAL_DRAFT_STATE);
  });
});
