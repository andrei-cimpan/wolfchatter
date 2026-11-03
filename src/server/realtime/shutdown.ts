import { stopRealtimeHub } from ".";

// Time for requests in flight to finish, which take milliseconds. Short because a plain `docker stop`
// was measured killing the process after about 3 s (Docker 29), whatever its documented default.
export const SHUTDOWN_DEADLINE_MS = 2_000;

const EXIT_CODES = { SIGTERM: 143, SIGINT: 130 };

/**
 * Next answers these signals by waiting for every request to finish before it exits, and a stream
 * never finishes, so one open tab would hold the process until it is killed. Closing the streams is
 * not enough with a browser connected: it reconnects during the wait, most likely over a keep-alive
 * connection Next's `server.close()` leaves open, and shutdown still hangs. So the deadline ends it
 * if Next has not by then, and the client catches up from another instance as after any drop.
 */
export function closeStreamsOnShutdown(
  signals: Pick<NodeJS.EventEmitter, "on">,
  stop: () => Promise<void> = stopRealtimeHub,
  exit: (code: number) => void = process.exit,
): void {
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    signals.on(signal, () => {
      if (stopping) return;
      stopping = true;
      stop().catch((error: unknown) => console.error("Realtime hub: stopping at shutdown failed", error));
      setTimeout(() => exit(EXIT_CODES[signal]), SHUTDOWN_DEADLINE_MS).unref();
    });
  }
}
