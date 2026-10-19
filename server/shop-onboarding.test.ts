/**
 * Real-Postgres tests for invite-only onboarding: public sign-up is closed,
 * shops are created by superadmins from the ops console, and a new owner
 * gets in through a one-time setup link. Skipped automatically when no
 * DATABASE_URL is configured, same as tenant-isolation.test.ts.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  organizations,
  passwordResetTokens,
  platformStaff,
  userBusinessRoles,
  users,
} from "../drizzle/schema";
import { adminRouter } from "./admin";
import { createOrganizationWithOwner, getDb, getUserByEmail } from "./db";
import { operatorContext } from "./testing/contexts";
import { createApp } from "./_core/app";
import type { TrpcContext } from "./_core/context";
import { ACCOUNT_SETUP_TTL_MS, hashOpaqueToken } from "./_core/localAuth";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function tokenFrom(setupUrl: string) {
  const token = new URL(setupUrl, "http://localhost").searchParams.get(
    "reset_token"
  );
  if (!token) throw new Error(`No reset_token in ${setupUrl}`);
  return token;
}

describeIfDb("invite-only shop onboarding (real Postgres)", () => {
  const stamp = Date.now();
  let superadmin: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let support: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let server: Server;
  let baseUrl: string;

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const owner = (label: string) => ({
      openId: `onboard-${label}-${stamp}`,
      name: label,
      email: `onboard-${label}-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    superadmin = await createOrganizationWithOwner(
      `Onboarding Ops ${stamp}`,
      owner("superadmin")
    );
    support = await createOrganizationWithOwner(
      `Onboarding Support ${stamp}`,
      owner("support")
    );
    const db = await getDb();
    await db!.insert(platformStaff).values([
      { userId: superadmin.user.id, role: "superadmin", isActive: true },
      { userId: support.user.id, role: "support", isActive: true },
    ]);
    server = createApp().listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it("refuses public sign-up, with or without a mode", async () => {
    for (const body of [
      {
        name: "Walk In",
        email: `walkin-${stamp}@example.com`,
        password: "password-123",
        orgName: "Walk-in Shop",
        mode: "create_org",
      },
      {
        name: "Walk In",
        email: `walkin-${stamp}@example.com`,
        password: "password-123",
        orgName: "Walk-in Shop",
      },
    ]) {
      const response = await post("/api/auth/register", body);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("SIGNUP_DISABLED");
    }
    expect(await getUserByEmail(`walkin-${stamp}@example.com`)).toBeUndefined();
  });

  it("lets a superadmin create a shop whose owner sets a password through the setup link", async () => {
    const ownerEmail = `new-owner-${stamp}@example.com`;
    const result = await adminRouter
      .createCaller(operatorContext(superadmin.user))
      .organizations.create({
        shopName: `Fresh Shop ${stamp}`,
        ownerName: "Fresh Owner",
        ownerEmail: ownerEmail.toUpperCase(),
      });
    expect(result.emailed).toBe(false);

    const db = await getDb();
    const owner = (await getUserByEmail(ownerEmail))!;
    expect(owner).toMatchObject({
      role: "admin",
      organizationId: result.organizationId,
      passwordHash: null,
    });
    const [organization] = await db!
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.organizationId));
    expect(organization.ownerId).toBe(owner.id);
    const [membership] = await db!
      .select()
      .from(userBusinessRoles)
      .where(eq(userBusinessRoles.userId, owner.id));
    expect(membership).toMatchObject({
      role: "admin",
      isActive: true,
      organizationId: result.organizationId,
    });

    // The setup link lasts about a week, not the 1 hour of a reset link.
    const [token] = await db!
      .select()
      .from(passwordResetTokens)
      .where(
        eq(
          passwordResetTokens.tokenHash,
          hashOpaqueToken(tokenFrom(result.setupUrl))
        )
      );
    expect(token.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      ACCOUNT_SETUP_TTL_MS - 60_000
    );

    // Before setup the owner can't sign in; after it they can.
    expect(
      (
        await post("/api/auth/login", {
          email: ownerEmail,
          password: "owner-password-1",
        })
      ).status
    ).toBe(401);
    const setup = await post("/api/auth/reset", {
      token: tokenFrom(result.setupUrl),
      password: "owner-password-1",
    });
    expect(setup.status).toBe(200);
    expect(
      (
        await post("/api/auth/login", {
          email: ownerEmail,
          password: "owner-password-1",
        })
      ).status
    ).toBe(200);
  });

  it("refuses shop creation by support staff and by shop owners", async () => {
    const input = {
      shopName: `Blocked Shop ${stamp}`,
      ownerName: "Blocked Owner",
      ownerEmail: `blocked-${stamp}@example.com`,
    };
    await expect(
      adminRouter
        .createCaller(contextFor(support.user))
        .organizations.create(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const shopOwner = await createOrganizationWithOwner(`Plain Shop ${stamp}`, {
      openId: `onboard-plain-${stamp}`,
      name: "Plain Owner",
      email: `onboard-plain-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    await expect(
      adminRouter
        .createCaller(contextFor(shopOwner.user))
        .organizations.create(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getUserByEmail(input.ownerEmail)).toBeUndefined();
  });

  it("refuses an email that already has an account", async () => {
    await expect(
      adminRouter
        .createCaller(operatorContext(superadmin.user))
        .organizations.create({
          shopName: `Dup Shop ${stamp}`,
          ownerName: "Dup Owner",
          ownerEmail: superadmin.user.email!,
        })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("re-issues the owner's setup link only until they have set a password", async () => {
    const caller = adminRouter.createCaller(operatorContext(superadmin.user));
    const { organizationId, setupUrl: first } =
      await caller.organizations.create({
        shopName: `Relink Shop ${stamp}`,
        ownerName: "Relink Owner",
        ownerEmail: `relink-${stamp}@example.com`,
      });
    const { setupUrl: second } = await caller.organizations.ownerSetupLink({
      organizationId,
    });
    // Issuing a new link retires the old one.
    expect(
      (
        await post("/api/auth/reset", {
          token: tokenFrom(first),
          password: "relink-password-1",
        })
      ).status
    ).toBe(400);
    expect(
      (
        await post("/api/auth/reset", {
          token: tokenFrom(second),
          password: "relink-password-1",
        })
      ).status
    ).toBe(200);

    await expect(
      caller.organizations.ownerSetupLink({ organizationId })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const detail = await caller.organizations.detail({ organizationId });
    expect(
      detail.users.find(user => user.email === `relink-${stamp}@example.com`)
        ?.hasPassword
    ).toBe(true);
    expect(detail.users[0]).not.toHaveProperty("passwordHash");
  });
});
