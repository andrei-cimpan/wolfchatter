// The pool waits with no limit for a connection, and a load balancer's probe should not.
const HEALTH_TIMEOUT_MS = 2_000;

const HEADERS = { "Cache-Control": "no-store" };

/** 200 if `ping` resolves in time, otherwise 503. The reason goes to the log, not to the caller. */
export async function healthResponse(ping: () => Promise<void>, timeoutMs = HEALTH_TIMEOUT_MS): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return Response.json({ status: "ok" }, { headers: HEADERS });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ status: "unavailable" }, { status: 503, headers: HEADERS });
  } finally {
    clearTimeout(timer);
  }
}
