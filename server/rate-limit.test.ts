import { describe, expect, it } from "vitest";
import { clientKey } from "./_core/rateLimit";

describe("rate limit client key", () => {
  it("keeps IPv4 addresses as they are, including IPv4-mapped IPv6", () => {
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("puts every address in the same IPv6 /64 in one bucket", () => {
    const a = clientKey("2001:db8:abcd:12:1111:2222:3333:4444");
    const b = clientKey("2001:db8:abcd:12:ffff:eeee:dddd:cccc");
    expect(a).toBe(b);
    expect(clientKey("2001:db8:abcd:13::1")).not.toBe(a);
  });

  it("handles compressed IPv6 and missing addresses", () => {
    expect(clientKey("2001:db8::1")).toBe(clientKey("2001:db8::2"));
    expect(clientKey(undefined)).toBe("unknown");
  });
});
