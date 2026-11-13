import { describe, expect, it } from "vitest";
import { keepFormAfter } from "./useFormAcrossSignOut";

describe("keepFormAfter", () => {
  it("keeps a form with text when the user goes from signed in to signed out", () => {
    expect(keepFormAfter({ from: "signedIn", to: "signedOut", hasText: true, kept: false })).toBe(true);
  });

  it("lets an empty form go", () => {
    expect(keepFormAfter({ from: "signedIn", to: "signedOut", hasText: false, kept: false })).toBe(false);
  });

  it("stops keeping it once the text is gone, or the user is signed in again", () => {
    expect(keepFormAfter({ from: "signedOut", to: "signedOut", hasText: false, kept: true })).toBe(false);
    expect(keepFormAfter({ from: "signedOut", to: "signedIn", hasText: true, kept: true })).toBe(false);
  });

  it("goes on keeping it while text is there", () => {
    expect(keepFormAfter({ from: "signedOut", to: "signedOut", hasText: true, kept: true })).toBe(true);
  });

  it("never shows a form that was not there, such as on a first load signed out", () => {
    expect(keepFormAfter({ from: "loading", to: "signedOut", hasText: true, kept: false })).toBe(false);
  });
});
