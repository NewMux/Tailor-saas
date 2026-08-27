import * as Sentry from "@sentry/node";
import { ENV } from "./env";

let initialized = false;

/**
 * Optional: only sends events if SENTRY_DSN is configured. Self-hosted
 * deployments without a Sentry project keep running with no behavior change.
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: ENV.isProduction ? "production" : "development",
    tracesSampleRate: 0,
  });
  initialized = true;
}

export function captureError(error: unknown) {
  if (!initialized) return;
  Sentry.captureException(error);
}
