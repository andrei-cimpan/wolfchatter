/** How a cluster is drawn: its accessible name, its text, and a diameter that grows with the count. */
export function clusterBubble(count: number): { label: string; text: string; size: number } {
  return {
    label: `${count} chatroom${count === 1 ? "" : "s"}`,
    // Four digits would not fit the bubble.
    text: count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count),
    // At least 44 px, so it is a comfortable touch target.
    size: count >= 100 ? 56 : count >= 10 ? 50 : 44,
  };
}
