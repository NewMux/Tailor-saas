/** Sign-in behavior for operators and per-account lockout, through the real auth routes. */
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authEvents, authSessions, organizations, platformStaff, users } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { emailHash, LOCKOUT_MAX_ATTEMPTS } from "./_core/authEvents";
import { createAccountSetupLink, hashOpaqueToken, OPERATOR_SESSION_TTL_MS, registerAuthRoutes } from "./_core/localAuth";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("operator sign-in and lockout (real Postgres)", () => {
  const stamp = Date.now();
  const password = "correct horse battery";
  let server: Server;
  let base: string;

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

  /** Creates an account the way real ones are: through the one-time setup link. */
  async function accountWithPassword(tag: string, options: { operator?: "support" | "superadmin"; orgSuspended?: boolean } = {}) {
    const email = `auth-${tag}-${stamp}@example.com`;
    const created = await createOrganizationWithOwner(`Auth Org ${tag} ${stamp}`, { openId: `auth-${tag}-${stamp}`, name: `User ${tag}`, email, passwordHash: null, loginMethod: "local" });
    const db = (await getDb())!;
    if (options.operator) await db.insert(platformStaff).values({ userId: created.user.id, role: options.operator, isActive: true });
    const url = await createAccountSetupLink(created.user.id, "http://localhost");
    const response = await post("/api/auth/reset", { token: decodeURIComponent(url.split("reset_token=")[1]!), password });
    expect(response.status).toBe(200);
    if (options.orgSuspended) await db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, created.organization.id));
    return { ...created, email };
  }

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    registerAuthRoutes(app);
    server = createServer(app).listen(0);
    await once(server, "listening");
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(() => server?.close());

  it("records the real last sign-in time", async () => {
    const account = await accountWithPassword("last");
    const db = (await getDb())!;
    await db.update(users).set({ lastSignedIn: new Date("2020-01-01") }).where(eq(users.id, account.user.id));
    expect((await post("/api/auth/login", { email: account.email, password })).status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, account.user.id));
    expect(row.lastSignedIn.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("gives operators a 12 hour session and everyone else the long one", async () => {
    const operator = await accountWithPassword("op", { operator: "superadmin" });
    const member = await accountWithPassword("member");
    const db = (await getDb())!;
    const expiry = async (email: string) => {
      const { token } = (await (await post("/api/auth/login", { email, password })).json()) as { token: string };
      const [row] = await db.select().from(authSessions).where(eq(authSessions.tokenHash, hashOpaqueToken(token)));
      return row.expiresAt.getTime() - Date.now();
    };
    expect(await expiry(operator.email)).toBeLessThanOrEqual(OPERATOR_SESSION_TTL_MS);
    expect(await expiry(member.email)).toBeGreaterThan(OPERATOR_SESSION_TTL_MS * 2);
  });

  it("does not lock operators out when their shop is suspended, but still blocks shop users", async () => {
    const operator = await accountWithPassword("opsusp", { operator: "superadmin", orgSuspended: true });
    const member = await accountWithPassword("membersusp", { orgSuspended: true });
    expect((await post("/api/auth/login", { email: operator.email, password })).status).toBe(200);
    const blocked = await post("/api/auth/login", { email: member.email, password });
    expect(blocked.status).toBe(403);
  });

  it("locks an account after too many attempts without revealing it, and a good sign-in is refused while locked", async () => {
    const account = await accountWithPassword("lock");
    let last: Response | undefined;
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS; i++) last = await post("/api/auth/login", { email: account.email, password: "wrong password" });
    const normalFailure = await last!.json();
    const lockedFailure = await (await post("/api/auth/login", { email: account.email, password })).json();
    expect(lockedFailure).toEqual(normalFailure); // byte-identical: code and message
    expect(lockedFailure.error.code).toBe("INVALID_CREDENTIALS");
    const db = (await getDb())!;
    const events = await db.select().from(authEvents).where(eq(authEvents.emailHash, emailHash(account.email)));
    expect(events.some(event => event.type === "login_blocked")).toBe(true);
  });

  it("throttles unknown addresses the same way", async () => {
    const email = `ghost-${stamp}@example.com`;
    const first = await (await post("/api/auth/login", { email, password: "x" })).json();
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS; i++) await post("/api/auth/login", { email, password: "x" });
    expect(await (await post("/api/auth/login", { email, password: "x" })).json()).toEqual(first);
  });

  it("a successful sign-in resets the count", async () => {
    const account = await accountWithPassword("reset");
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS - 2; i++) await post("/api/auth/login", { email: account.email, password: "bad" });
    expect((await post("/api/auth/login", { email: account.email, password })).status).toBe(200);
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS - 2; i++) await post("/api/auth/login", { email: account.email, password: "bad" });
    expect((await post("/api/auth/login", { email: account.email, password })).status).toBe(200);
  });

  it("password reset and setup are never locked out", async () => {
    const account = await accountWithPassword("resetflow");
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS + 3; i++) await post("/api/auth/login", { email: account.email, password: "bad" });
    const url = await createAccountSetupLink(account.user.id, "http://localhost");
    const response = await post("/api/auth/reset", { token: decodeURIComponent(url.split("reset_token=")[1]!), password: "a brand new password" });
    expect(response.status).toBe(200);
  });

  it("re-auth confirms the password for the current session only", async () => {
    const operator = await accountWithPassword("reauth", { operator: "superadmin" });
    const { token } = (await (await post("/api/auth/login", { email: operator.email, password })).json()) as { token: string };
    const db = (await getDb())!;
    await db.update(authSessions).set({ reauthAt: null }).where(eq(authSessions.tokenHash, hashOpaqueToken(token)));

    expect((await post("/api/auth/reauth", { password: "wrong" }, token)).status).toBe(401);
    expect((await post("/api/auth/reauth", { password }, undefined)).status).toBe(401);
    const ok = await post("/api/auth/reauth", { password }, token);
    expect(ok.status).toBe(200);
    const [row] = await db.select().from(authSessions).where(eq(authSessions.tokenHash, hashOpaqueToken(token)));
    expect(row.reauthAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
