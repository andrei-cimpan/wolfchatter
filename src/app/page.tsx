import { MapView } from "@/components/MapView";
import { RoomPanel } from "@/components/RoomPanel";

export default function Home() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden md:relative md:block">
      <h1 className="sr-only">Wolfchatter</h1>
      {/* `isolate` keeps Leaflet's high z-index panes and controls from covering the panel. */}
      <div className="relative isolate min-h-0 flex-1 md:absolute md:inset-0">
        <MapView />
      </div>
      <RoomPanel />
    </main>
  );
}
