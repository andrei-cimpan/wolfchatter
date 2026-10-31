"use client";

import dynamic from "next/dynamic";

// Leaflet reads `window` when it loads, so it can only run in the browser.
export const MapView = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-zinc-200 dark:bg-zinc-800" />,
});
