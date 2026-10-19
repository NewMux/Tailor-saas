/**
 * Browser security headers, shared by the Express app (local, Docker) and the
 * Vercel build output (scripts/build-vercel.ts), so both serve the same policy.
 *
 * The Content-Security-Policy is sent as report-only until it has been seen to
 * cause no violations on a real deployment (login, point of sale, billing with
 * Paddle checkout). To enforce it, set CSP_ENFORCE=1 at build/run time or flip
 * CSP_ENFORCED below; the hosts allowed here are the only third parties the
 * app loads: Google Fonts and Paddle.js (loaded on demand for checkout).
 */
export const CSP_ENFORCED = process.env.CSP_ENFORCE === "1";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://cdn.paddle.com",
  // React, Radix, sonner and recharts set inline styles.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.paddle.com",
  "frame-src https://*.paddle.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  [CSP_ENFORCED ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only"]: CONTENT_SECURITY_POLICY,
};

export const HSTS = "max-age=31536000; includeSubDomains";
