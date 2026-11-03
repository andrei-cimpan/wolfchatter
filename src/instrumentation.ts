export async function register(): Promise<void> {
  // Next also compiles this file for the Edge runtime, which has no `pg`.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // It reads its limits as it loads, so a typo surfaces here, not as a 500 on the first request to
    // a route. Next only logs an error from this hook and goes on listening, so exit explicitly.
    try {
      await import("@/server/http/rate-limit");
    } catch (error) {
      console.error("Invalid configuration", error);
      process.exit(1);
    }
    const { closeStreamsOnShutdown } = await import("@/server/realtime/shutdown");
    closeStreamsOnShutdown(process);
  }
}
