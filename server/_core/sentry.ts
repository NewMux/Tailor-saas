import * as Sentry from "@sentry/node";
import { ENV } from "./env";
import { redactErrorMessage } from "./logger";

let initialized = false;

/**
 * Optional: only sends events if SENTRY_DSN is configured. Self-hosted
 * deployments without a Sentry project keep running with no behavior change.
 */
/** Removes anything credential- or customer-shaped before an event leaves the server. */
export function scrubSentryEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactErrorMessage(exception.value);
  }
  return event;
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: ENV.isProduction ? "production" : "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: event => scrubSentryEvent(event),
  });
  initialized = true;
}

export function captureError(error: unknown) {
  if (!initialized) return;
  Sentry.captureException(error);
}
