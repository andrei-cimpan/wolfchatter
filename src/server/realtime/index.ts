import { createMessageSource } from "@/server/repositories";
import { InMemoryRealtimeHub, type RealtimeHub } from "./hub";

export type { RealtimeHub, Subscriber } from "./hub";

// One hub (and so one LISTEN connection) per process. Kept on globalThis because Next dev
// re-evaluates modules on every edit, which would otherwise open another listener each time.
const globalForRealtime = globalThis as typeof globalThis & { wolfchatterRealtimeHub?: RealtimeHub };

export function getRealtimeHub(): RealtimeHub {
  globalForRealtime.wolfchatterRealtimeHub ??= new InMemoryRealtimeHub(createMessageSource());
  return globalForRealtime.wolfchatterRealtimeHub;
}
