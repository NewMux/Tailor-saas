import type { Express } from "express";
import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function authLimiter(limit: number, options: { skipSuccessfulRequests?: boolean } = {}) {
  return rateLimit({
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
  if (process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_DISABLED === "1") return;
  app.post("/api/auth/login", authLimiter(20, { skipSuccessfulRequests: true }));
  app.post("/api/auth/reset", authLimiter(10, { skipSuccessfulRequests: true }));
  app.post("/api/auth/register", authLimiter(20));
  app.post("/api/auth/forgot", authLimiter(5));
  app.post("/api/auth/reauth", authLimiter(10, { skipSuccessfulRequests: true }));
  app.get("/api/auth/invite", authLimiter(30));
}
