export async function register(): Promise<void> {
  // Next also compiles this file for the Edge runtime, which has no `pg`.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { closeStreamsOnShutdown } = await import("@/server/realtime/shutdown");
    closeStreamsOnShutdown(process);
  }
}
