import { createMessageSource } from "@/server/repositories";
import { InMemoryRealtimeHub, type RealtimeHub } from "./hub";

export type { RealtimeHub, Subscriber } from "./hub";

// One hub (and so one LISTEN connection) per process. Kept on globalThis because Next dev
// re-evaluates modules on every edit, which would otherwise open another listener each time.
// The flip side: edits to the hub or the source only take effect after restarting `npm run dev`.
const globalForRealtime = globalThis as typeof globalThis & { wolfchatterRealtimeHub?: InMemoryRealtimeHub };

export function getRealtimeHub(): RealtimeHub {
  globalForRealtime.wolfchatterRealtimeHub ??= new InMemoryRealtimeHub(createMessageSource());
  return globalForRealtime.wolfchatterRealtimeHub;
}

/** Closes every stream and the LISTEN connection, for a graceful shutdown. The next getRealtimeHub() starts afresh. */
export async function stopRealtimeHub(): Promise<void> {
  const hub = globalForRealtime.wolfchatterRealtimeHub;
  globalForRealtime.wolfchatterRealtimeHub = undefined;
  await hub?.stop();
}
