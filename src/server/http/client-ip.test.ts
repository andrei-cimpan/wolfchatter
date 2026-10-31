import { describe, expect, it } from "vitest";
import { UNKNOWN_CLIENT, clientIp, rateLimitKey } from "./client-ip";

const withForwarded = (value: string) => new Request("http://test/", { headers: { "x-forwarded-for": value } });

describe("clientIp", () => {
  it("reads a single address", () => {
    expect(clientIp(withForwarded("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("uses the rightmost entry, the one our proxy appended", () => {
    expect(clientIp(withForwarded("1.2.3.4, 10.0.0.1, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("trims whitespace around entries", () => {
    expect(clientIp(withForwarded("1.2.3.4 ,  203.0.113.7  "))).toBe("203.0.113.7");
  });

  it("keeps IPv6 addresses whole", () => {
    expect(clientIp(withForwarded("2001:db8::1"))).toBe("2001:db8::1");
  });

  it.each(["", " ", "1.2.3.4, "])("falls back to the shared key for %j", (value) => {
    expect(clientIp(withForwarded(value))).toBe(UNKNOWN_CLIENT);
  });

  it("falls back to the shared key without the header", () => {
    expect(clientIp(new Request("http://test/"))).toBe(UNKNOWN_CLIENT);
  });
});

describe("rateLimitKey", () => {
  it("keys an IPv4 address by itself", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
  });

  // One subscriber usually gets a whole /64 and can pick any address in it.
  it.each([
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"],
    ["2001:DB8:0001:0002:0:0:0:1", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["2001:db8:1:2:3:4:1.2.3.4", "2001:db8:1:2::/64"],
  ])("keys the IPv6 address %s by its /64 (%s)", (ip, key) => {
    expect(rateLimitKey(ip)).toBe(key);
  });

  it("gives every address in one /64 the same key", () => {
    expect(rateLimitKey("2001:db8:1:2::a")).toBe(rateLimitKey("2001:db8:1:2:dead:beef:0:1"));
    expect(rateLimitKey("2001:db8:1:2::a")).not.toBe(rateLimitKey("2001:db8:1:3::a"));
  });

  it.each(["::ffff:203.0.113.7", "::FFFF:cb00:7107", "0:0:0:0:0:ffff:203.0.113.7"])(
    "keys the IPv4-mapped address %s as the IPv4 address",
    (ip) => {
      expect(rateLimitKey(ip)).toBe("203.0.113.7");
    },
  );

  it.each(["unknown", "not-an-ip", "1.2.3"])("keeps %j as it is", (value) => {
    expect(rateLimitKey(value)).toBe(value);
  });
});
