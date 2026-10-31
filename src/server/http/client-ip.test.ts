import { describe, expect, it } from "vitest";
import { UNKNOWN_CLIENT, clientIp } from "./client-ip";

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
