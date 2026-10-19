import type { Express } from "express";
import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * One client address per bucket. IPv6 clients usually hold a whole /64, so
 * counting each /128 separately would let a single machine rotate addresses
 * to dodge the limit; mask IPv6 to its /64 prefix.
 */
export function clientKey(ip: string | undefined) {
  if (!ip) return "unknown";
  const address = ip.replace(/^::ffff:/i, "");
  if (!address.includes(":")) return address;
  const groups = address.split("::")[0]!.split(":").filter(Boolean);
  if (address.includes("::") || groups.length >= 4) return `${groups.slice(0, 4).join(":")}::/64`;
  return address;
}

function authLimiter(limit: number, options: { skipSuccessfulRequests?: boolean } = {}) {
  return rateLimit({
    keyGenerator: request => clientKey(request.ip),
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a few minutes and try again." } },
  });
}

/**
 * Per-IP throttling for the unauthenticated auth endpoints. Relies on
 * `trust proxy` (set in createApp) so req.ip is the real client address
 * behind Vercel's proxy rather than the proxy itself. On Vercel the counters
 * live in each function instance's memory, so the limits are per instance:
 * a brake on brute force, not an exact quota.
 *
 * Login and reset only count failed attempts, so a busy shop with many
 * staff signing in from one IP never gets locked out by successful logins.
 */
export function registerAuthRateLimits(app: Express) {
  // The off switch exists for tests and local runs only; it can never silence production.
  if (process.env.NODE_ENV === "test" || (process.env.RATE_LIMIT_DISABLED === "1" && process.env.NODE_ENV !== "production")) return;
  app.post("/api/auth/login", authLimiter(20, { skipSuccessfulRequests: true }));
  app.post("/api/auth/reset", authLimiter(10, { skipSuccessfulRequests: true }));
  app.post("/api/auth/register", authLimiter(20));
  app.post("/api/auth/forgot", authLimiter(5));
  app.post("/api/auth/reauth", authLimiter(10, { skipSuccessfulRequests: true }));
  app.get("/api/auth/invite", authLimiter(30));
}

/**
 * Brake for the authenticated document proxy: every request costs a session
 * and an access lookup. Generous, because a page of documents loads many files.
 */
export const storageRateLimit = rateLimit({
  keyGenerator: request => clientKey(request.ip),
  windowMs: FIFTEEN_MINUTES,
  limit: process.env.NODE_ENV === "test" ? Number.MAX_SAFE_INTEGER : 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a few minutes and try again." } },
});
