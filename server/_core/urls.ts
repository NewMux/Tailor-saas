import type { Request } from "express";
import { ENV } from "./env";

/**
 * Public origin used in links we hand to people (reset, invite, welcome).
 * AUTH_BASE_URL is required in production; the request origin is only a
 * development convenience.
 */
export function appBaseUrl(req?: Pick<Request, "headers">) {
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin : "";
  return (ENV.authBaseUrl || origin || "").replace(/\/$/, "");
}
