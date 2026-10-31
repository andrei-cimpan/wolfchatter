/** Key used when a request carries no address, so such requests share one budget. */
export const UNKNOWN_CLIENT = "unknown";

/**
 * The caller's IP for rate limiting: the rightmost `X-Forwarded-For` entry.
 *
 * Route handlers cannot see the socket. Next.js fills `X-Forwarded-For` with the socket address
 * only when the header is absent, and a proxy such as the ALB appends the address it saw, so the
 * rightmost entry is the one written by our side. Entries to its left come from the client and can
 * be anything. Without a proxy in front, a client can set the header itself (see DESIGN.md).
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || UNKNOWN_CLIENT;
}
