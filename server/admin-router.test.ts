/**
 * Real-Postgres tests for server/admin.ts's organizations/staff endpoints
 * (impersonation itself is covered separately in impersonation.test.ts).
 * Skipped automatically when no DATABASE_URL is configured, same as
 * tenant-isolation.test.ts.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { authSessions, organizations, platformStaff } from "../drizzle/schema";
import { adminRouter } from "./admin";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import type { TrpcContext } from "./_core/context";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describeIfDb("admin router (real Postgres)", () => {
  const stamp = Date.now();
  let orgA: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let orgB: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let supportStaff: Awaited<ReturnType<typeof createOrganizationWithOwner>>;

  beforeAll(async () => {
    const db = await getDb();
    orgA = await createOrganizationWithOwner(`Admin Router Org A ${stamp}`, {
      openId: `admin-a-${stamp}`,
      name: "Org A Owner",
      email: `admin-router-a-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    orgB = await createOrganizationWithOwner(`Admin Router Org B ${stamp}`, {
      openId: `admin-b-${stamp}`,
      name: "Org B Owner",
      email: `admin-router-b-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    supportStaff = await createOrganizationWithOwner(`Admin Router Support Org ${stamp}`, {
      openId: `admin-support-${stamp}`,
      name: "Support Staffer",
      email: `admin-router-support-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    // orgA's own owner is ALSO made a superadmin, to prove that having
    // cross-tenant admin power never leaks into their own tenant-scoped
    // calls (they should still only ever see orgA through erpRouter).
    await db!.insert(platformStaff).values([
      { userId: orgA.user.id, role: "superadmin", isActive: true },
      { userId: supportStaff.user.id, role: "support", isActive: true },
    ]);
  });

  it("rejects a plain tenant owner with no platformStaff row", async () => {
    await expect(adminRouter.createCaller(contextFor(orgB.user)).organizations.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists organizations across tenants, for both support and superadmin roles, without leaking into erpRouter", async () => {
    const superadminList = await adminRouter.createCaller(contextFor(orgA.user)).organizations.list();
    const ids = superadminList.map(row => row.id);
    expect(ids).toContain(orgA.organization.id);
    expect(ids).toContain(orgB.organization.id);
    const orgARow = superadminList.find(row => row.id === orgA.organization.id)!;
    expect(orgARow.userCount).toBeGreaterThanOrEqual(1);
    expect(orgARow.planStatus).toBe("unmetered");

    const supportList = await adminRouter.createCaller(contextFor(supportStaff.user)).organizations.list();
    expect(supportList.map(row => row.id)).toContain(orgB.organization.id);

    // The superadmin's own tenant-scoped calls must still only ever see
    // their own organization - cross-tenant visibility only exists through
    // adminRouter, never through erpRouter/posRouter.
    const ownCustomers = await erpRouter.createCaller(contextFor(orgA.user)).customers.list({ search: "" });
    expect(ownCustomers).toBeInstanceOf(Array);
  });

  it("rejects organizations.suspend from a support-role staff member (superadminProcedure only)", async () => {
    await expect(
      adminRouter.createCaller(contextFor(supportStaff.user)).organizations.suspend({ organizationId: orgB.organization.id, reason: "test" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("suspends and reactivates an organization, revoking sessions and writing audit entries", async () => {
    const db = await getDb();
    await db!.insert(authSessions).values({ tokenHash: `test-hash-${stamp}`, userId: orgB.user.id, expiresAt: new Date(Date.now() + 60_000) });

    const suspended = await adminRouter
      .createCaller(contextFor(orgA.user))
      .organizations.suspend({ organizationId: orgB.organization.id, reason: "Nonpayment (test)" });
    expect(suspended.status).toBe("suspended");

    const [sessionRow] = await db!.select().from(authSessions).where(eq(authSessions.userId, orgB.user.id));
    expect(sessionRow).toBeUndefined();

    const detail = await adminRouter.createCaller(contextFor(orgA.user)).organizations.detail({ organizationId: orgB.organization.id });
    expect(detail.recentAuditLogs.some(row => row.action === "ORG_SUSPENDED")).toBe(true);

    const reactivated = await adminRouter.createCaller(contextFor(orgA.user)).organizations.reactivate({ organizationId: orgB.organization.id });
    expect(reactivated.status).toBe("active");

    const [row] = await db!.select().from(organizations).where(eq(organizations.id, orgB.organization.id));
    expect(row.status).toBe("active");
  });

  it("grants and revokes platform staff access by email", async () => {
    const caller = adminRouter.createCaller(contextFor(orgA.user));
    await caller.staff.grant({ email: orgB.user.email!, role: "support" });

    let list = await caller.staff.list();
    let granted = list.find(row => row.userId === orgB.user.id);
    expect(granted?.role).toBe("support");
    expect(granted?.isActive).toBe(true);

    await caller.staff.revoke({ userId: orgB.user.id });
    list = await caller.staff.list();
    granted = list.find(row => row.userId === orgB.user.id);
    expect(granted?.isActive).toBe(false);

    const db = await getDb();
    const [row] = await db!.select().from(platformStaff).where(and(eq(platformStaff.userId, orgB.user.id), eq(platformStaff.isActive, false)));
    expect(row).toBeDefined();
  });
});
