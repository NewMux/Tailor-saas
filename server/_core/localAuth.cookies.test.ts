import { describe, expect, it } from "vitest";
import { buildClearedSessionCookieHeader, buildSessionCookieHeader } from "./localAuth";

describe("session cookie attributes", () => {
  it("is never SameSite=None, in production or otherwise", () => {
    // SameSite=None is the classic CSRF footgun: it hands the cookie to
    // cross-site requests. This deployment is always single-origin (see
    // DEPLOYMENT.md), so nothing legitimate needs it, in either environment.
    expect(buildSessionCookieHeader("token123", true)).not.toContain("SameSite=None");
    expect(buildSessionCookieHeader("token123", false)).not.toContain("SameSite=None");
    expect(buildSessionCookieHeader("token123", true)).toContain("SameSite=Lax");
  });

  it("is always HttpOnly, so client-side script can never read it", () => {
    expect(buildSessionCookieHeader("token123", true)).toContain("HttpOnly");
    expect(buildClearedSessionCookieHeader(false)).toContain("HttpOnly");
  });

  it("sets Secure only when the deployment is running over HTTPS (production)", () => {
    expect(buildSessionCookieHeader("token123", true)).toContain("; Secure");
    expect(buildSessionCookieHeader("token123", false)).not.toContain("Secure");
  });

  it("clearing the cookie matches the same SameSite/Secure attributes it was set with", () => {
    expect(buildClearedSessionCookieHeader(true)).toContain("SameSite=Lax");
    expect(buildClearedSessionCookieHeader(true)).toContain("; Secure");
    expect(buildClearedSessionCookieHeader(true)).toContain("Max-Age=0");
  });

  it("URL-encodes the token so a token containing cookie-special characters cannot break the header", () => {
    expect(buildSessionCookieHeader("a;b=c", true)).toContain("erp_session=a%3Bb%3Dc");
  });
});
