import { describe, expect, it } from "vitest";
import { currentUserFrom } from "./useCurrentUser";

describe("currentUserFrom", () => {
  it("is loading until /api/me has answered, so neither the form nor the prompt flashes", () => {
    expect(currentUserFrom({ isPending: true, data: undefined })).toEqual({ status: "loading", name: null });
  });

  it("is signed in with the name the user posts under", () => {
    expect(currentUserFrom({ isPending: false, data: { name: "Ana P." } })).toEqual({
      status: "signedIn",
      name: "Ana P.",
    });
  });

  it("is signed out when there is no name", () => {
    expect(currentUserFrom({ isPending: false, data: { name: null } })).toEqual({ status: "signedOut", name: null });
  });

  // Reading stays possible, and the prompt lets the user try signing in.
  it("is signed out when /api/me failed", () => {
    expect(currentUserFrom({ isPending: false, data: undefined })).toEqual({ status: "signedOut", name: null });
  });
});
