import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  authSessions,
  passwordResetTokens,
  users,
  type User,
} from "../../drizzle/schema";
import { acceptInviteAndCreateUser, getActiveInviteByTokenHash, getDb, getOrganizationById, getPlatformStaffByUserId, getUserByEmail, getUserById } from "../db";
import { ENV, isEmailConfigured } from "./env";
import { sendEmail } from "./email";
import { passwordResetEmail } from "./emailTemplates";
import { logger } from "./logger";
import { appBaseUrl } from "./urls";
import { captureError } from "./sentry";
import { purgeOldAuthNoise, recordAuthEvent, registerLoginAttempt } from "./authEvents";
import type { ImpersonationMode } from "./impersonationPolicy";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Operators hold cross-tenant power, so their sessions are short. */
export const OPERATOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;
export const IMPERSONATION_WRITE_TTL_MS = 15 * 60 * 1000;
export const OPERATOR_SETUP_TTL_MS = 24 * 60 * 60 * 1000;
/** A password confirmation stays valid this long for high-risk operator actions. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
// A new shop owner's "set your password" link: longer than a reset link,
// since it's handed over by email or by hand and may not be opened at once.
export const ACCOUNT_SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "erp_session";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "BAD_REQUEST"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `$scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

// Verified against when the email is unknown, so a failed login costs one
// scrypt either way and response time doesn't reveal which emails exist.
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString("hex"));

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[1] !== "scrypt") return false;
  const salt = Buffer.from(parts[2], "base64url");
  const expected = Buffer.from(parts[3], "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomToken(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function tokenFromRequest(req: Request) {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim() || undefined;
  }
  return readCookie(req, SESSION_COOKIE);
}

// SameSite=Lax: the frontend and API share one origin, so the cookie is
// never needed on cross-site requests, and withholding it there blocks
// cross-site request forgery against cookie-authenticated endpoints. (The
// app's own requests authenticate with the Bearer token anyway.)
function setSessionCookie(res: Response, token: string) {
  const secure = ENV.secureCookies ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${ENV.secureCookies ? "; Secure" : ""}`
  );
}

function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function createSessionInternal(
  userId: number,
  opts: { impersonatedBy?: number; mode?: ImpersonationMode; ttlMs?: number } = {}
) {
  const db = await getDb();
  if (!db)
    throw new AuthError("Database unavailable", 503, "DATABASE_UNAVAILABLE");
  const now = new Date();
  await db
    .delete(authSessions)
    .where(
      and(eq(authSessions.userId, userId), lt(authSessions.expiresAt, now))
    );
  const impersonating = opts.impersonatedBy !== undefined;
  // Decided here, not at login, because password reset and account setup
  // create sessions too.
  const ttlMs =
    opts.ttlMs ??
    ((await getPlatformStaffByUserId(userId)) ? OPERATOR_SESSION_TTL_MS : SESSION_TTL_MS);
  const token = randomToken("local");
  await db.insert(authSessions).values({
    tokenHash: hashOpaqueToken(token),
    userId,
    impersonatedBy: opts.impersonatedBy ?? null,
    impersonationMode: impersonating ? (opts.mode ?? "readonly") : null,
    // A session created from a password (login, reset, setup) counts as a fresh confirmation.
    reauthAt: impersonating ? null : now,
    expiresAt: new Date(now.getTime() + ttlMs),
    lastUsedAt: now,
  });
  return token;
}

async function createSession(userId: number) {
  return createSessionInternal(userId);
}

/**
 * Starts a short-TTL session "as" another user, for platform-staff support
 * impersonation. Never call this directly from a route - go through
 * server/admin.ts's impersonation.start, which is the only place that
 * checks superadminProcedure and writes the audit trail entry.
 */
export async function createImpersonationSession(
  targetUserId: number,
  platformStaffUserId: number,
  mode: ImpersonationMode = "readonly"
) {
  return createSessionInternal(targetUserId, {
    impersonatedBy: platformStaffUserId,
    mode,
    ttlMs: mode === "write" ? IMPERSONATION_WRITE_TTL_MS : IMPERSONATION_TTL_MS,
  });
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  if (!db) return;
  await db
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, hashOpaqueToken(token)));
}

/** Ends an impersonation session and returns its row (for audit-log duration), or undefined if it was already gone. */
export async function endImpersonationSession(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const tokenHash = hashOpaqueToken(token);
  const session = (
    await db.select().from(authSessions).where(eq(authSessions.tokenHash, tokenHash)).limit(1)
  )[0];
  if (!session) return undefined;
  await db.delete(authSessions).where(eq(authSessions.id, session.id));
  return session;
}

/** Signs a user out everywhere, e.g. after a password reset or removal from their shop. */
export async function revokeAllSessionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
}

/** Ends every impersonation session a platform-staff member started, e.g. when their access is revoked. */
export async function revokeImpersonationSessionsBy(platformStaffUserId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(authSessions).where(eq(authSessions.impersonatedBy, platformStaffUserId));
}

export function sessionTokenFromRequest(req: Request) {
  return tokenFromRequest(req);
}

export async function getUserForRequest(
  req: Request
): Promise<
  | {
      user: User;
      impersonatedBy: number | null;
      session: { id: number; createdAt: Date; reauthAt: Date | null; impersonationMode: ImpersonationMode | null };
    }
  | undefined
> {
  const token = tokenFromRequest(req);
  if (!token) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const now = new Date();
  const session = (
    await db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.tokenHash, hashOpaqueToken(token)),
          gt(authSessions.expiresAt, now)
        )
      )
      .limit(1)
  )[0];
  if (!session) return undefined;
  // An impersonation session is only as good as the superadmin access that
  // started it: once that is revoked, the session stops working at once.
  if (session.impersonatedBy !== null) {
    const impersonator = await getPlatformStaffByUserId(session.impersonatedBy);
    if (impersonator?.role !== "superadmin") {
      await db.delete(authSessions).where(eq(authSessions.id, session.id));
      return undefined;
    }
  }
  await db
    .update(authSessions)
    .set({ lastUsedAt: now })
    .where(eq(authSessions.id, session.id));
  const user = await getUserById(session.userId);
  if (!user) return undefined;
  return {
    user,
    impersonatedBy: session.impersonatedBy,
    session: {
      id: session.id,
      createdAt: session.createdAt,
      reauthAt: session.reauthAt,
      // A missing or unknown mode on an impersonation session means read-only.
      impersonationMode:
        session.impersonatedBy === null ? null : session.impersonationMode === "write" ? "write" : "readonly",
    },
  };
}

async function createResetToken(userId: number, ttlMs = RESET_TTL_MS) {
  const db = await getDb();
  if (!db)
    throw new AuthError("Database unavailable", 503, "DATABASE_UNAVAILABLE");
  const rawToken = randomToken("reset");
  const now = new Date();
  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId));
  await db.insert(passwordResetTokens).values({
    tokenHash: hashOpaqueToken(rawToken),
    userId,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return rawToken;
}

function resetUrl(baseUrl: string, token: string) {
  return `${baseUrl}/?reset_token=${encodeURIComponent(token)}`;
}

/**
 * One-time link for a new shop owner (created by platform staff, with no
 * password yet) to choose their password. It is a password-reset token with
 * a longer lifetime, so it is redeemed by the normal /api/auth/reset flow.
 */
export async function createAccountSetupLink(userId: number, baseUrl: string, ttlMs = ACCOUNT_SETUP_TTL_MS) {
  return resetUrl(baseUrl, await createResetToken(userId, ttlMs));
}

async function touchLastSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

async function register(req: Request, res: Response) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email =
    typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  // Invite-only: new shops are created by platform staff (admin.ts
  // organizations.create), so the only self-service registration left is a
  // staff member accepting their shop's invite.
  if (req.body?.mode !== "join_invite")
    throw new AuthError(
      "New shops are set up by our team. Contact us to get an account.",
      403,
      "SIGNUP_DISABLED"
    );
  if (name.length < 2 || name.length > 160)
    throw new AuthError("Enter a valid full name.");
  if (!email || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email))
    throw new AuthError("Enter a valid email address.");
  if (password.length < 8 || password.length > 200)
    throw new AuthError("Password must be between 8 and 200 characters.");

  const db = await getDb();
  if (!db)
    throw new AuthError("Database unavailable", 503, "DATABASE_UNAVAILABLE");
  if (await getUserByEmail(email))
    throw new AuthError(
      "An account already exists for this email. Use the password reset option.",
      409,
      "ACCOUNT_EXISTS"
    );

  const passwordHash = await hashPassword(password);
  const newUser = {
    openId: `local_${randomUUID()}`,
    name,
    email,
    passwordHash,
    loginMethod: "local",
  };

  let user: User;
  try {
    const inviteToken =
      typeof req.body?.inviteToken === "string"
        ? req.body.inviteToken.trim()
        : "";
    if (!inviteToken)
      throw new AuthError(
        "An invite link is required to join a shop.",
        400,
        "INVITE_REQUIRED"
      );
    const invite = await getActiveInviteByTokenHash(
      hashOpaqueToken(inviteToken)
    );
    if (!invite)
      throw new AuthError(
        "This invite link is invalid or has expired.",
        400,
        "INVITE_INVALID"
      );
    // The invite is addressed to one person: without this check anyone
    // who got hold of the link could join the shop under any address.
    if (normalizeEmail(invite.email) !== email)
      throw new AuthError(
        "Use the email address this invite was sent to.",
        400,
        "INVITE_EMAIL_MISMATCH"
      );
    const result = await acceptInviteAndCreateUser(invite.id, newUser);
    user = result.user;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      error instanceof Error ? error.message : "Unable to create the account",
      400,
      "ACCOUNT_CREATE_FAILED"
    );
  }

  const token = await createSession(user.id);
  await touchLastSignedIn(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user), token });
}

async function login(req: Request, res: Response) {
  const email =
    typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const invalid = new AuthError(
    "Invalid email or password.",
    401,
    "INVALID_CREDENTIALS"
  );
  // Per-account throttle: too many recent attempts look exactly like a wrong
  // password (and still cost one scrypt), so it reveals nothing.
  const throttle = email ? await registerLoginAttempt(email, req) : { blocked: false };
  const user = email ? await getUserByEmail(email) : undefined;
  const passwordMatches = await verifyPassword(
    password,
    user?.passwordHash ?? (await DUMMY_PASSWORD_HASH)
  );
  if (throttle.blocked) {
    await recordAuthEvent({ type: "login_blocked", email, userId: user?.id, req });
    throw invalid;
  }
  if (!user || !user.passwordHash || !passwordMatches) {
    if (email) await recordAuthEvent({ type: "login_failed", email, userId: user?.id, req });
    if (user && !user.passwordHash) {
      throw new AuthError(
        "This account has no password yet. Use the setup link you were sent, or \"Forgot password?\".",
        401,
        "PASSWORD_RESET_REQUIRED"
      );
    }
    throw invalid;
  }
  // Platform staff are not locked out by their shop being suspended: that is
  // how they would investigate or reactivate it.
  if (user.organizationId && !(await getPlatformStaffByUserId(user.id))) {
    const organization = await getOrganizationById(user.organizationId);
    if (organization?.status === "suspended") {
      throw new AuthError(
        "This organization's access has been suspended. Contact support.",
        403,
        "ORG_SUSPENDED"
      );
    }
  }
  const token = await createSession(user.id);
  await touchLastSignedIn(user.id);
  await recordAuthEvent({ type: "login_success", email, userId: user.id, req });
  void purgeOldAuthNoise().catch(() => undefined);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), token });
}

async function forgotPassword(req: Request, res: Response) {
  const email =
    typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const user = email ? await getUserByEmail(email) : undefined;
  let resetUrlValue: string | undefined;
  if (user?.email) {
    await recordAuthEvent({ type: "reset_requested", email, userId: user.id, req });
    const token = await createResetToken(user.id);
    resetUrlValue = resetUrl(appBaseUrl(req), token);
    const { sent } = await sendEmail(passwordResetEmail(user.email, resetUrlValue));
    if (sent) {
      logger.info({ email }, "Password reset email sent");
    } else {
      // Without a mail provider the operator still needs a way to hand the
      // link over, so it is logged, but never when it has already been
      // emailed: a reset link in the logs is a credential.
      // A reset link is a credential: only development logs it.
      logger.info({ email, ...(ENV.isProduction ? {} : { resetUrl: resetUrlValue }) }, "Password reset link generated (email not sent)");
    }
  }
  res.json({
    message: isEmailConfigured()
      ? "If an account exists for this email, we've sent a password reset link. Check your inbox."
      : "If an account exists for this email, a reset link has been generated for the server administrator.",
    ...(ENV.isProduction ? {} : { resetUrl: resetUrlValue }),
  });
}

/**
 * Lets the invite form show (and lock) the address the invite was sent to,
 * since registration must use exactly that address.
 */
async function describeInvite(req: Request, res: Response) {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  const invite = token ? await getActiveInviteByTokenHash(hashOpaqueToken(token)) : undefined;
  if (!invite) throw new AuthError("This invite link is invalid or has expired.", 404, "INVITE_INVALID");
  const organization = await getOrganizationById(invite.organizationId);
  res.json({ email: invite.email, name: invite.name, shopName: organization?.name ?? null });
}

async function resetPassword(req: Request, res: Response) {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (!token || password.length < 8 || password.length > 200)
    throw new AuthError("The reset token or new password is invalid.");

  const db = await getDb();
  if (!db)
    throw new AuthError("Database unavailable", 503, "DATABASE_UNAVAILABLE");
  const now = new Date();
  const reset = (
    await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashOpaqueToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .limit(1)
  )[0];
  if (!reset)
    throw new AuthError(
      "This password reset link is invalid or expired.",
      400,
      "RESET_TOKEN_INVALID"
    );

  // Claim the token atomically before changing anything: of two concurrent
  // requests with the same link, only one gets a row back.
  const [claimed] = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(eq(passwordResetTokens.id, reset.id), isNull(passwordResetTokens.usedAt))
    )
    .returning({ id: passwordResetTokens.id });
  if (!claimed)
    throw new AuthError(
      "This password reset link is invalid or expired.",
      400,
      "RESET_TOKEN_INVALID"
    );

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash, loginMethod: "local", updatedAt: now })
    .where(eq(users.id, reset.userId));
  await revokeAllSessionsForUser(reset.userId);
  const user = await getUserById(reset.userId);
  if (!user) throw new AuthError("Account not found", 404, "ACCOUNT_NOT_FOUND");
  const sessionToken = await createSession(user.id);
  await touchLastSignedIn(user.id);
  await recordAuthEvent({ type: "reset_completed", email: user.email, userId: user.id, req });
  setSessionCookie(res, sessionToken);
  res.json({
    user: publicUser({ ...user, passwordHash }),
    token: sessionToken,
  });
}

/**
 * Password confirmation for the current session ("sudo mode"). High-risk
 * operator actions require it to be recent. Throttled like sign-in.
 */
async function reauth(req: Request, res: Response) {
  const auth = await getUserForRequest(req);
  if (!auth || auth.impersonatedBy !== null)
    throw new AuthError("Please sign in again.", 401, "UNAUTHENTICATED");
  const email = auth.user.email ?? "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const throttle = email ? await registerLoginAttempt(email, req) : { blocked: false };
  const matches = await verifyPassword(password, auth.user.passwordHash ?? (await DUMMY_PASSWORD_HASH));
  if (throttle.blocked || !matches || !auth.user.passwordHash) {
    await recordAuthEvent({ type: "reauth_failed", email, userId: auth.user.id, req });
    throw new AuthError("Invalid password.", 401, "INVALID_CREDENTIALS");
  }
  const db = await getDb();
  const now = new Date();
  await db?.update(authSessions).set({ reauthAt: now }).where(eq(authSessions.id, auth.session.id));
  await recordAuthEvent({ type: "reauth_success", email, userId: auth.user.id, req });
  res.json({ ok: true, reauthValidUntil: new Date(now.getTime() + REAUTH_WINDOW_MS).toISOString() });
}

function sendError(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }
  logger.error({ err: error }, "Unexpected auth error");
  captureError(error);
  res
    .status(500)
    .json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Authentication service unavailable.",
      },
    });
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req, res) => {
    try {
      await register(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      await login(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/auth/forgot", async (req, res) => {
    try {
      await forgotPassword(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/auth/reset", async (req, res) => {
    try {
      await resetPassword(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/auth/reauth", async (req, res) => {
    try {
      await reauth(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/auth/invite", async (req, res) => {
    try {
      await describeInvite(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/auth/session", async (req, res) => {
    try {
      const result = await getUserForRequest(req);
      res.json({
        authenticated: Boolean(result),
        user: result ? publicUser(result.user) : null,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      await revokeSession(tokenFromRequest(req));
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });
}
