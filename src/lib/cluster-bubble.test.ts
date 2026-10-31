import { describe, expect, it } from "vitest";
import { clusterBubble } from "./cluster-bubble";

describe("clusterBubble", () => {
  it("names the cluster by its count", () => {
    expect(clusterBubble(3).label).toBe("3 chatrooms");
    expect(clusterBubble(1).label).toBe("1 chatroom");
  });

  it("shortens thousands so the text fits", () => {
    expect(clusterBubble(999).text).toBe("999");
    expect(clusterBubble(1500).text).toBe("1k");
    expect(clusterBubble(1500).label).toBe("1500 chatrooms");
  });

  it("grows with the count and never drops below a 44 px touch target", () => {
    expect(clusterBubble(2).size).toBe(44);
    expect(clusterBubble(10).size).toBe(50);
    expect(clusterBubble(100).size).toBe(56);
  });
});
