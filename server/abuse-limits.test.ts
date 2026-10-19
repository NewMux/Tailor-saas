/** Enumeration, mail-bombing, error disclosure and invite caps. Real Postgres where state is involved. */
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditLogs, authEvents, passwordResetTokens } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import { emailHash } from "./_core/authEvents";
import { registerAuthRoutes } from "./_core/localAuth";
import { scrubSentryEvent } from "./_core/sentry";
import { publicProcedure, router } from "./_core/trpc";
import { appBaseUrl } from "./_core/urls";
import type { TrpcContext } from "./_core/context";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("abuse limits and error disclosure (real Postgres)", () => {
  const stamp = Date.now();
  let server: Server;
  let base: string;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    const boom = router({
      boom: publicProcedure.query(() => {
        throw new Error('Failed query: insert into "users" ("passwordHash") values ($1)\nparams: $scrypt$salt$hash');
      }),
    });
    app.use("/trpc", createExpressMiddleware({ router: boom, createContext: () => ({ user: null, req: {} as never, res: {} as never }) as TrpcContext }));
    server = createServer(app).listen(0);
    await once(server, "listening");
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(() => server?.close());

  it("sign-up does not reveal which addresses already have accounts", async () => {
    const owner = await createOrganizationWithOwner(`Enum Shop ${stamp}`, { openId: `en-${stamp}`, name: "Owner", email: `enum-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    const known = await (await post("/api/auth/register", { mode: "join_invite", name: "Someone", email: owner.user.email, password: "long enough password" })).json();
    const unknown = await (await post("/api/auth/register", { mode: "join_invite", name: "Someone", email: `nobody-${stamp}@example.com`, password: "long enough password" })).json();
    expect(known).toEqual(unknown);
    expect(known.error.code).toBe("INVITE_REQUIRED");
    const withBadInvite = await (await post("/api/auth/register", { mode: "join_invite", name: "Someone", email: owner.user.email, password: "long enough password", inviteToken: "invite_bogus" })).json();
    expect(withBadInvite.error.code).toBe("INVITE_INVALID");
  });

  it("limits reset emails per address and keeps a pending link alive", async () => {
    const owner = await createOrganizationWithOwner(`Reset Shop ${stamp}`, { openId: `rs-${stamp}`, name: "Owner", email: `reset-${stamp}@example.com`, passwordHash: "$scrypt$x$y", loginMethod: "local" });
    const db = (await getDb())!;
    const tokenCount = async () => (await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, owner.user.id)))[0]?.id;
    for (let i = 0; i < 3; i++) expect((await post("/api/auth/forgot", { email: owner.user.email })).status).toBe(200);
    const afterThree = await tokenCount();
    for (let i = 0; i < 3; i++) {
      const response = await post("/api/auth/forgot", { email: owner.user.email });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("resetUrl");
    }
    expect(await tokenCount()).toBe(afterThree); // later requests neither email nor replace the link
    const events = await db.select().from(authEvents).where(and(eq(authEvents.emailHash, emailHash(owner.user.email!)), eq(authEvents.type, "reset_requested")));
    expect(events.length).toBe(6);
  });

  it("never hands a client the SQL or values of an unexpected failure in production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await fetch(`${base}/trpc/boom`);
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).not.toContain("scrypt");
      expect(text).not.toContain("insert into");
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("scrubs credentials and SQL values from error reports", () => {
    const event = scrubSentryEvent({
      type: undefined,
      request: { headers: { authorization: "Bearer SECRET" }, cookies: { erp_session: "SECRET" }, data: "{\"password\":\"x\"}", query_string: "token=SECRET", url: "https://x/api" },
      exception: { values: [{ value: "Failed query: insert\nparams: HUNTER2" }] },
    } as never) as { request: Record<string, unknown>; exception: { values: Array<{ value: string }> } };
    expect(JSON.stringify(event)).not.toMatch(/SECRET|HUNTER2/);
  });

  it("only trusts the request's Origin header in development", () => {
    const req = { headers: { origin: "https://evil.example" } };
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(appBaseUrl(req)).not.toContain("evil.example");
      process.env.NODE_ENV = "test";
      expect(appBaseUrl(req)).not.toContain("evil.example");
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("caps staff invite emails per shop per day", async () => {
    const org = await createOrganizationWithOwner(`Cap Shop ${stamp}`, { openId: `cap-${stamp}`, name: "Owner", email: `cap-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    const api = erpRouter.createCaller({ user: org.user, req: { headers: {} } as never, res: {} as never });
    const role = await api.team.createCustomRole({ name: "Helper", description: "", permissions: ["dashboard"] });
    const db = (await getDb())!;
    await db.insert(auditLogs).values(Array.from({ length: 50 }, () => ({ organizationId: org.organization.id, actorId: org.user.id, action: "STAFF_ACCESS_PREPARED", entityType: "staffAccessInvite" })));
    await expect(api.access.inviteStaff({ name: "One More", email: `more-${stamp}@example.com`, customRoleId: role.id })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

vi.setConfig({ testTimeout: 30000 });
