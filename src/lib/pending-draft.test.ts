import { beforeEach, describe, expect, it } from "vitest";
import { PENDING_DRAFT_KEY, savePendingDraft, takePendingDraft } from "./pending-draft";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe("pending draft", () => {
  it("gives back the saved position once", () => {
    savePendingDraft(storage, { lat: 44.43, lng: 26.1 });
    expect(takePendingDraft(storage)).toEqual({ lat: 44.43, lng: 26.1 });
    expect(takePendingDraft(storage)).toBeNull();
  });

  it("is null when nothing was saved", () => {
    expect(takePendingDraft(storage)).toBeNull();
  });

  it.each([
    ["malformed JSON", "{lat:"],
    ["a latitude past the pole", JSON.stringify({ lat: 91, lng: 0 })],
    ["a missing key", JSON.stringify({ lat: 1 })],
    ["a non-number", JSON.stringify({ lat: "1", lng: 2 })],
    ["null", "null"],
  ])("ignores %s and clears it", (_label, raw) => {
    storage.setItem(PENDING_DRAFT_KEY, raw);
    expect(takePendingDraft(storage)).toBeNull();
    expect(storage.getItem(PENDING_DRAFT_KEY)).toBeNull();
  });

  // Storage can throw (blocked, or full); losing the pin is better than breaking sign-in or the page.
  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => savePendingDraft(broken, { lat: 1, lng: 2 })).not.toThrow();
    expect(takePendingDraft(broken)).toBeNull();
  });
});
