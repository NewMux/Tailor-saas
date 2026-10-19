import type { Request } from "express";
import { ENV } from "./env";

/**
 * Public origin used in links we hand to people (reset, invite, welcome).
 * AUTH_BASE_URL is required in production; the request origin is only a
 * development convenience.
 */
export function appBaseUrl(req?: Pick<Request, "headers">) {
  // The request's Origin header is chosen by the caller, so it is only ever a
  // development fallback: trusting it elsewhere would let anyone have a reset
  // link for someone else's account emailed to a site of their choosing.
  const origin = process.env.NODE_ENV === "development" && typeof req?.headers?.origin === "string" ? req.headers.origin : "";
  return (ENV.authBaseUrl || origin || "").replace(/\/$/, "");
}
