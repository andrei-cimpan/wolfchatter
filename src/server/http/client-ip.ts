import { isIPv4, isIPv6 } from "node:net";

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

/**
 * The budget an address spends from. IPv4 is one address per budget. IPv6 is keyed by its /64,
 * because a subscriber is usually handed a whole /64 and can rotate through 2^64 addresses in it,
 * each of which would otherwise get a fresh budget. Anything that is not an IP is kept as it is.
 */
export function rateLimitKey(ip: string): string {
  if (isIPv4(ip)) return ip;
  const address = ip.split("%")[0] ?? ip; // drop a zone id such as %eth0
  if (!isIPv6(address)) return ip;

  const hextets = expandIPv6(address);
  // ::ffff:a.b.c.d is an IPv4 client seen by a dual-stack socket, so it shares the IPv4 budget.
  if (hextets.slice(0, 6).join(":") === "0:0:0:0:0:ffff") return mappedIPv4(hextets.slice(6));
  return `${hextets.slice(0, 4).join(":")}::/64`;
}

function mappedIPv4(rest: string[]): string {
  const [high = "0", low = "0"] = rest;
  if (high.includes(".")) return high;
  const bits = (parseInt(high, 16) << 16) | parseInt(low, 16);
  return [24, 16, 8, 0].map((shift) => (bits >>> shift) & 0xff).join(".");
}

// Expands a valid IPv6 address into 8 hextets without leading zeros. A trailing dotted IPv4 part
// (as in ::ffff:1.2.3.4) is kept as written in the last slot, since only the prefix is needed.
function expandIPv6(address: string): string[] {
  const [head = "", tail] = address.toLowerCase().split("::");
  const parse = (part: string) => (part ? part.split(":") : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const dotted = (right.length ? right : left).at(-1)?.includes(".") ?? false;
  const size = dotted ? 7 : 8;
  const zeros = Array<string>(size - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((h) => (h.includes(".") ? h : parseInt(h, 16).toString(16)));
}
