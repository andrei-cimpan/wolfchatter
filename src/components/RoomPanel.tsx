// Narrow screens: a sheet in the page flow below the map, so it never hides the map's
// attribution. From md up: a card floating over the map's top-right corner, as in the mockups.
export function RoomPanel() {
  return (
    <aside
      aria-label="Chat"
      className="z-10 rounded-t-2xl border-t border-foreground/15 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.1)] md:absolute md:top-4 md:right-4 md:flex md:max-h-[calc(100dvh-2rem)] md:flex-col md:overflow-hidden md:w-[380px] md:rounded-md md:border md:border-foreground/30 md:pb-4 md:shadow-md"
    >
      <p>Click on the map to start a chat</p>
    </aside>
  );
}
