import rateLimit, { type Options } from "express-rate-limit";

/**
 * Rate limits for the unauthenticated local-auth endpoints. These are the
 * classic brute-force / credential-stuffing / signup-abuse targets: nothing
 * upstream of them (no session, no tenant scoping) can throttle a bad actor,
 * so this is the only backstop. Express's `trust proxy` (set in app.ts) has
 * to be configured correctly behind Coolify's reverse proxy or every request
 * would key off the proxy's own IP - see the ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
 * validation that express-rate-limit itself performs on startup.
 */
const jsonHandler: Options["handler"] = (req, res) => {
  res.status(429).json({
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Please wait a few minutes and try again.",
    },
  });
};

const baseOptions = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: jsonHandler,
} satisfies Partial<Options>;

/** Login: generous enough for a genuine typo or two, tight against brute force. */
export const loginRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

/** Registration: a fresh organization gets a free trial, so this also guards against trial-abuse signup floods. */
export const registerRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
});

/** Password reset request: guards against using the endpoint to email-bomb an address or enumerate accounts by timing. */
export const forgotPasswordRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
});

/** Reset-token redemption: a genuine user retries a mistyped password a few times. */
export const resetPasswordRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});
