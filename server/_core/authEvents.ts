import { createHash } from "node:crypto";
import type { Request } from "express";
import { and, count, eq, gt, inArray, lt, max } from "drizzle-orm";
import { authEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export const LOCKOUT_MAX_ATTEMPTS = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const NOISE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthEventType =
  | "login_attempt"
  | "login_failed"
  | "login_success"
  | "login_blocked"
  | "reset_requested"
  | "reset_completed"
  | "reauth_success"
  | "reauth_failed"
  | "session_revoked";

export function emailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function recordAuthEvent(event: {
  type: AuthEventType;
  email?: string | null;
  userId?: number | null;
  req?: Pick<Request, "ip" | "headers"> | null;
  details?: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  const userAgent = event.req?.headers?.["user-agent"];
  await db.insert(authEvents).values({
    type: event.type,
    userId: event.userId ?? null,
    emailHash: event.email ? emailHash(event.email) : null,
    ip: event.req?.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 255) : null,
    detailsJson: event.details === undefined ? null : JSON.stringify(event.details),
  });
}

/**
 * Per-account throttle for password attempts, shared by every server
 * instance through the database. The attempt is recorded first and counted
 * afterwards so parallel guesses cannot overshoot the limit. A successful
 * sign-in resets the count. Keyed by the address whether or not an account
 * exists, so it reveals nothing.
 */
export async function registerLoginAttempt(email: string, req: Pick<Request, "ip" | "headers">) {
  const db = await getDb();
  if (!db) return { blocked: false };
  const hash = emailHash(email);
  await recordAuthEvent({ type: "login_attempt", email, req });
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const [lastSuccess] = await db
    .select({ at: max(authEvents.createdAt) })
    .from(authEvents)
    .where(and(eq(authEvents.emailHash, hash), eq(authEvents.type, "login_success"), gt(authEvents.createdAt, windowStart)));
  const since = lastSuccess?.at && lastSuccess.at > windowStart ? lastSuccess.at : windowStart;
  const [attempts] = await db
    .select({ n: count() })
    .from(authEvents)
    .where(and(eq(authEvents.emailHash, hash), eq(authEvents.type, "login_attempt"), gt(authEvents.createdAt, since)));
  return { blocked: Number(attempts?.n ?? 0) > LOCKOUT_MAX_ATTEMPTS };
}

/** Failed-attempt noise is kept for a month; successes and privileged events stay longer. */
export async function purgeOldAuthNoise() {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(authEvents)
    .where(and(inArray(authEvents.type, ["login_attempt", "login_failed", "login_blocked"]), lt(authEvents.createdAt, new Date(Date.now() - NOISE_RETENTION_MS))));
}

const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX_PER_WINDOW = 3;

/** True when this address has already asked for enough reset links this hour. */
export async function tooManyResetRequests(email: string) {
  const db = await getDb();
  if (!db) return false;
  const [recent] = await db
    .select({ n: count() })
    .from(authEvents)
    .where(and(eq(authEvents.emailHash, emailHash(email)), eq(authEvents.type, "reset_requested"), gt(authEvents.createdAt, new Date(Date.now() - RESET_WINDOW_MS))));
  return Number(recent?.n ?? 0) >= RESET_MAX_PER_WINDOW;
}
