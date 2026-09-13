function cleanEnvironmentValue(value: string | undefined): string {
  return value?.trim().replace(/^['\"]|['\"]$/g, "") ?? "";
}

function cleanEnvironmentNumber(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number.parseInt(cleanEnvironmentValue(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const ENV = {
  databaseUrl: cleanEnvironmentValue(process.env.DATABASE_URL),
  authBaseUrl: cleanEnvironmentValue(process.env.AUTH_BASE_URL),
  allowedOrigin: cleanEnvironmentValue(process.env.ALLOWED_ORIGIN),
  isProduction: process.env.NODE_ENV === "production",
  secureCookies: process.env.NODE_ENV === "production",
  forgeApiUrl: cleanEnvironmentValue(process.env.BUILT_IN_FORGE_API_URL),
  forgeApiKey: cleanEnvironmentValue(process.env.BUILT_IN_FORGE_API_KEY),
};

/**
 * Paddle Billing configuration. Every value is read at runtime rather than
 * baked into the frontend bundle at build time, so switching a deployment
 * from sandbox to live is an environment change plus a restart - not a
 * rebuild. The client fetches the public half of this via billing.config.
 *
 * When paddleApiKey/paddlePriceId are unset the app runs in "billing
 * disabled" mode: trials never expire and no checkout is offered. That keeps
 * local development and the CI test suite working with no Paddle account.
 */
export const BILLING = {
  paddleApiKey: cleanEnvironmentValue(process.env.PADDLE_API_KEY),
  paddleWebhookSecret: cleanEnvironmentValue(process.env.PADDLE_WEBHOOK_SECRET),
  // Safe to expose to the browser - it is the publishable half of the pair.
  paddleClientToken: cleanEnvironmentValue(process.env.PADDLE_CLIENT_TOKEN),
  paddlePriceId: cleanEnvironmentValue(process.env.PADDLE_PRICE_ID),
  paddleEnvironment:
    cleanEnvironmentValue(process.env.PADDLE_ENVIRONMENT) === "production"
      ? "production"
      : "sandbox",
  trialDays: cleanEnvironmentNumber(process.env.BILLING_TRIAL_DAYS, 14),
  // Fallback price shown on the public landing page when Paddle's localized
  // price preview is unavailable (blocked script, offline, misconfiguration).
  // Keep it in step with the real price configured in Paddle.
  displayPrice:
    cleanEnvironmentValue(process.env.BILLING_DISPLAY_PRICE) || "29",
  displayCurrency:
    cleanEnvironmentValue(process.env.BILLING_DISPLAY_CURRENCY) || "USD",
  // Days an organization keeps working after a renewal payment fails, so a
  // declined card doesn't close a shop's till mid-day while Paddle retries.
  gracePeriodDays: cleanEnvironmentNumber(process.env.BILLING_GRACE_DAYS, 7),
} as const;

/**
 * Billing is only enforced once Paddle is actually configured. A deployment
 * with no Paddle credentials must not paywall itself - there would be no way
 * for anyone to pay.
 */
export function isBillingConfigured(): boolean {
  return Boolean(
    BILLING.paddleApiKey && BILLING.paddlePriceId && BILLING.paddleClientToken
  );
}
