/**
 * Real-Postgres regression tests for authentication/authorization hardening:
 * what auth.me exposes, impersonation boundaries, session revocation when
 * access is withdrawn, owner protection, and the HTTP auth endpoints
 * (cookie flags, single-use reset links). Skipped automatically when no
 * DATABASE_URL is configured, same as tenant-isolation.test.ts.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authSessions,
  passwordResetTokens,
  platformStaff,
  userBusinessRoles,
  users,
} from "../drizzle/schema";
import { adminRouter } from "./admin";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import { appRouter } from "./routers";
import { createApp } from "./_core/app";
import type { TrpcContext } from "./_core/context";
import { hashOpaqueToken, randomToken } from "./_core/localAuth";
import { sdk } from "./_core/sdk";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** Mirrors server/_core/context.ts's createContext, against a real session lookup. */
async function contextFromToken(token: string): Promise<TrpcContext> {
  const req = {
    headers: { authorization: `Bearer ${token}` },
  } as unknown as TrpcContext["req"];
  const auth = await sdk.authenticateRequest(req);
  return {
    req,
    res: {} as TrpcContext["res"],
    user: auth.user,
    impersonation: auth.impersonatedBy
      ? { platformStaffUserId: auth.impersonatedBy }
      : null,
  };
}

async function insertSession(userId: number) {
  const token = randomToken("local");
  const db = await getDb();
  await db!.insert(authSessions).values({
    tokenHash: hashOpaqueToken(token),
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

async function sessionStillValid(token: string) {
  try {
    await sdk.authenticateRequest({
      headers: { authorization: `Bearer ${token}` },
    } as unknown as TrpcContext["req"]);
    return true;
  } catch {
    return false;
  }
}

describeIfDb("auth hardening (real Postgres)", () => {
  const stamp = Date.now();
  let superadmin: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let shop: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let otherStaff: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let employee: typeof users.$inferSelect;
  let secondAdmin: typeof users.$inferSelect;

  async function addMember(label: string, role: "admin" | "sales") {
    const db = await getDb();
    const [user] = await db!
      .insert(users)
      .values({
        openId: `hard-${label}-${stamp}`,
        name: label,
        email: `hard-${label}-${stamp}@example.com`,
        loginMethod: "local",
        organizationId: shop.organization.id,
      })
      .returning();
    await db!
      .insert(userBusinessRoles)
      .values({ userId: user.id, organizationId: shop.organization.id, role });
    return user;
  }

  beforeAll(async () => {
    const owner = (label: string) => ({
      openId: `hard-${label}-${stamp}`,
      name: label,
      email: `hard-${label}-${stamp}@example.com`,
      passwordHash: "$scrypt$c2FsdA$aGFzaA",
      loginMethod: "local",
    });
    superadmin = await createOrganizationWithOwner(
      `Hardening Ops ${stamp}`,
      owner("superadmin")
    );
    shop = await createOrganizationWithOwner(
      `Hardening Shop ${stamp}`,
      owner("shop-owner")
    );
    otherStaff = await createOrganizationWithOwner(
      `Hardening Other Ops ${stamp}`,
      owner("other-staff")
    );
    const db = await getDb();
    await db!.insert(platformStaff).values([
      { userId: superadmin.user.id, role: "superadmin", isActive: true },
      { userId: otherStaff.user.id, role: "superadmin", isActive: true },
    ]);
    employee = await addMember("employee", "sales");
    secondAdmin = await addMember("second-admin", "admin");
  });

  it("auth.me never returns the password hash or openId", async () => {
    const me = await appRouter.createCaller(contextFor(shop.user)).auth.me();
    expect(me).not.toBeNull();
    expect(me).not.toHaveProperty("passwordHash");
    expect(me).not.toHaveProperty("openId");
    expect(me).toMatchObject({
      id: shop.user.id,
      email: shop.user.email,
      role: "admin",
    });
  });

  describe("impersonation", () => {
    it("refuses to impersonate platform staff or yourself", async () => {
      const caller = adminRouter.createCaller(contextFor(superadmin.user));
      await expect(
        caller.impersonation.start({
          userId: otherStaff.user.id,
          reason: "Trying to borrow operator access",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.impersonation.start({
          userId: superadmin.user.id,
          reason: "Impersonating myself",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("never grants platform routes to an impersonation session, even if the target is platform staff", async () => {
      const { token } = await adminRouter
        .createCaller(contextFor(superadmin.user))
        .impersonation.start({ userId: employee.id, reason: "Support ticket" });
      // Target becomes platform staff after the session started.
      const db = await getDb();
      await db!
        .insert(platformStaff)
        .values({ userId: employee.id, role: "superadmin", isActive: true });
      try {
        const ctx = await contextFromToken(token);
        await expect(
          adminRouter.createCaller(ctx).organizations.list()
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const me = await appRouter.createCaller(ctx).auth.me();
        expect(me?.isPlatformStaff).toBe(false);
      } finally {
        await db!
          .delete(platformStaff)
          .where(eq(platformStaff.userId, employee.id));
      }
    });

    it("ends a superadmin's impersonation sessions when their access is revoked", async () => {
      const { token } = await adminRouter
        .createCaller(contextFor(otherStaff.user))
        .impersonation.start({ userId: employee.id, reason: "Support ticket" });
      expect(await sessionStillValid(token)).toBe(true);

      await adminRouter
        .createCaller(contextFor(superadmin.user))
        .staff.revoke({ userId: otherStaff.user.id });
      expect(await sessionStillValid(token)).toBe(false);
    });
  });

  describe("shop team management", () => {
    it("refuses to demote or deactivate the shop owner, but still manages other members", async () => {
      const caller = erpRouter.createCaller(contextFor(secondAdmin));
      await expect(
        caller.team.assignRole({
          userId: shop.user.id,
          role: "sales",
          isActive: true,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.team.assignRole({
          userId: shop.user.id,
          role: "admin",
          isActive: false,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.team.assignRole({
          userId: employee.id,
          role: "tailor",
          isActive: true,
        })
      ).resolves.toEqual({
        success: true,
      });
    });

    it("signs a removed member out of every session", async () => {
      const removable = await addMember("removable", "sales");
      const token = await insertSession(removable.id);
      expect(await sessionStillValid(token)).toBe(true);

      await erpRouter
        .createCaller(contextFor(shop.user))
        .team.removeUser({ userId: removable.id });
      expect(await sessionStillValid(token)).toBe(false);
    });
  });

  it("system.notifyOwner is not available to shop owners", async () => {
    await expect(
      appRouter
        .createCaller(contextFor(shop.user))
        .system.notifyOwner({ title: "Hi", content: "Spam" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  describe("HTTP auth endpoints", () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      server = createApp().listen(0);
      await new Promise(resolve => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise(resolve => server.close(resolve));
    });

    async function post(path: string, body: unknown) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("issues a SameSite=Lax, HttpOnly session cookie", async () => {
      const response = await post("/api/auth/register", {
        name: "Cookie Owner",
        email: `hard-cookie-${stamp}@example.com`,
        password: "correct horse battery",
        orgName: `Cookie Shop ${stamp}`,
      });
      expect(response.status).toBe(201);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("SameSite=None");
    });

    it("rejects unknown emails and wrong passwords with the same error", async () => {
      const unknown = await post("/api/auth/login", {
        email: `nobody-${stamp}@example.com`,
        password: "whatever123",
      });
      const wrong = await post("/api/auth/login", {
        email: `hard-cookie-${stamp}@example.com`,
        password: "not the password",
      });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(await unknown.json()).toEqual(await wrong.json());
    });

    it("redeems a password reset link only once, even under concurrent requests", async () => {
      const rawToken = randomToken("reset");
      const db = await getDb();
      await db!.insert(passwordResetTokens).values({
        tokenHash: hashOpaqueToken(rawToken),
        userId: employee.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const otherSession = await insertSession(employee.id);

      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          post("/api/auth/reset", {
            token: rawToken,
            password: `new-password-${i}`,
          })
        )
      );
      const statuses = responses.map(response => response.status).sort();
      expect(statuses).toEqual([200, 400, 400, 400]);
      // Sessions from before the reset are gone.
      expect(await sessionStillValid(otherSession)).toBe(false);
    });
  });
});
