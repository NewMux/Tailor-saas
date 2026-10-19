/**
 * Real-Postgres tests for platform-staff impersonation (server/admin.ts).
 * Builds contexts the same way server/_core/context.ts does (via
 * sdk.authenticateRequest against a fake Request carrying the issued
 * token), so these exercise the real session lookup, not a hand-built
 * TrpcContext - the thing that actually matters here is what a real
 * subsequent request sees. Skipped automatically when no DATABASE_URL is
 * configured, same as tenant-isolation.test.ts.
 */
import { IMPERSONATION_BLOCKED_ERR_MSG, IMPERSONATION_READ_ONLY_ERR_MSG, ORG_SUSPENDED_ERR_MSG, REAUTH_REQUIRED_ERR_MSG } from "@shared/const";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { auditLogs, authSessions, organizations, platformAuditLogs, platformStaff } from "../drizzle/schema";
import { adminRouter } from "./admin";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import type { TrpcContext } from "./_core/context";
import { hashOpaqueToken, IMPERSONATION_TTL_MS, IMPERSONATION_WRITE_TTL_MS } from "./_core/localAuth";
import { sdk } from "./_core/sdk";
import { contextFromToken, operatorContext } from "./testing/contexts";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function fakeRequest(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as TrpcContext["req"];
}

describeIfDb("impersonation (real Postgres)", () => {
  const stamp = Date.now();
  let staff: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let target: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let otherTarget: Awaited<ReturnType<typeof createOrganizationWithOwner>>;

  beforeAll(async () => {
    const db = await getDb();
    staff = await createOrganizationWithOwner(`Impersonation Staff Org ${stamp}`, {
      openId: `imp-staff-${stamp}`,
      name: "Staff Owner",
      email: `imp-staff-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    target = await createOrganizationWithOwner(`Impersonation Target Org ${stamp}`, {
      openId: `imp-target-${stamp}`,
      name: "Target Owner",
      email: `imp-target-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    otherTarget = await createOrganizationWithOwner(`Impersonation Other Org ${stamp}`, {
      openId: `imp-other-${stamp}`,
      name: "Other Owner",
      email: `imp-other-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    await db!.insert(platformStaff).values({ userId: staff.user.id, role: "superadmin", isActive: true });
  });

  it("creates a short-TTL, read-only session by default and writes a start audit entry", async () => {
    const caller = adminRouter.createCaller(operatorContext(staff.user));
    const before = Date.now();
    const result = await caller.impersonation.start({ userId: target.user.id, reason: "Investigating a support ticket" });

    expect(result.mode).toBe("readonly");
    expect(result.expiresInMs).toBe(IMPERSONATION_TTL_MS);
    expect(result.target.id).toBe(target.user.id);

    const db = await getDb();
    const [sessionRow] = await db!.select().from(authSessions).where(eq(authSessions.tokenHash, hashOpaqueToken(result.token)));
    expect(sessionRow.userId).toBe(target.user.id);
    expect(sessionRow.impersonatedBy).toBe(staff.user.id);
    expect(sessionRow.impersonationMode).toBe("readonly");
    expect(sessionRow.expiresAt.getTime()).toBeGreaterThan(before + IMPERSONATION_TTL_MS - 5000);
    expect(sessionRow.expiresAt.getTime()).toBeLessThanOrEqual(before + IMPERSONATION_TTL_MS + 5000);

    const impersonationCtx = await contextFromToken(result.token);
    expect(impersonationCtx.user?.id).toBe(target.user.id);
    expect(impersonationCtx.impersonation).toEqual({ platformStaffUserId: staff.user.id, mode: "readonly" });

    // Reading works, changing anything does not.
    await expect(erpRouter.createCaller(impersonationCtx).customers.list({ search: "" })).resolves.toBeInstanceOf(Array);
    await expect(
      erpRouter.createCaller(impersonationCtx).customers.create({ name: "Nope Customer", phone: "33000001", email: "", address: "", notes: "", preferredContact: "phone" })
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: IMPERSONATION_READ_ONLY_ERR_MSG });
  });

  it("a session without a recorded mode is treated as read-only", async () => {
    const readonlyCtx = { ...contextFor(target.user), impersonation: { platformStaffUserId: staff.user.id } };
    await expect(
      erpRouter.createCaller(readonlyCtx).customers.create({ name: "Nope Customer", phone: "33000001", email: "", address: "", notes: "", preferredContact: "phone" })
    ).rejects.toMatchObject({ message: IMPERSONATION_READ_ONLY_ERR_MSG });
  });

  it("write mode needs a recent password confirmation", async () => {
    await expect(
      adminRouter.createCaller(operatorContext(staff.user, { reauth: false })).impersonation.start({ userId: target.user.id, reason: "Fix a record", mode: "write" })
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: REAUTH_REQUIRED_ERR_MSG });
  });

  it("write mode lets the operator fix data, tags the audit trail with the real operator, and ledgers the change", async () => {
    const result = await adminRouter.createCaller(operatorContext(staff.user)).impersonation.start({ userId: target.user.id, reason: "Fix a customer record", mode: "write" });
    expect(result.expiresInMs).toBe(IMPERSONATION_WRITE_TTL_MS);
    const ctx = await contextFromToken(result.token);
    expect(ctx.impersonation?.mode).toBe("write");

    const created = await erpRouter.createCaller(ctx).customers.create({
      name: "Impersonation Customer",
      phone: "33000001",
      email: "",
      address: "",
      notes: "",
      preferredContact: "phone",
    });
    const list = await erpRouter.createCaller(contextFor(target.user)).customers.list({ search: "Impersonation Customer" });
    expect(list.find(row => row.id === created.id)).toBeDefined();

    const db = await getDb();
    const [entry] = await db!.select().from(auditLogs).where(and(eq(auditLogs.action, "CUSTOMER_CREATED"), eq(auditLogs.entityId, created.id)));
    expect(entry.actorId).toBe(target.user.id);
    expect(entry.impersonatedBy).toBe(staff.user.id);

    const ledger = await db!.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, "IMPERSONATED_MUTATION"), eq(platformAuditLogs.actorId, staff.user.id)));
    expect(ledger.some(row => String(JSON.parse(row.detailsJson || "{}").path).endsWith("customers.create"))).toBe(true);
  });

  it("blocks access-minting and sensitive procedures in both modes", async () => {
    for (const mode of ["readonly", "write"] as const) {
      const result = await adminRouter.createCaller(operatorContext(staff.user)).impersonation.start({ userId: target.user.id, reason: "Policy check", mode });
      const ctx = await contextFromToken(result.token);
      const erp = erpRouter.createCaller(ctx);
      await expect(erp.access.inviteStaff({ name: "Back Door", email: "backdoor@example.com", customRoleId: 1 })).rejects.toMatchObject({ message: IMPERSONATION_BLOCKED_ERR_MSG });
      await expect(erp.team.assignRole({ userId: target.user.id, role: "admin", isActive: true })).rejects.toMatchObject({ message: IMPERSONATION_BLOCKED_ERR_MSG });
      await expect(erp.billing.portalUrl()).rejects.toMatchObject({ message: IMPERSONATION_BLOCKED_ERR_MSG });
      await expect(erp.staff.list()).rejects.toMatchObject({ message: IMPERSONATION_BLOCKED_ERR_MSG });
    }
  });

  it("write mode allows only the listed data fixes, not money or deletes", async () => {
    const result = await adminRouter.createCaller(operatorContext(staff.user)).impersonation.start({ userId: target.user.id, reason: "Policy check", mode: "write" });
    const ctx = await contextFromToken(result.token);
    await expect(erpRouter.createCaller(ctx).invoices.delete({ id: 1, reason: "no" } as never)).rejects.toMatchObject({ message: IMPERSONATION_BLOCKED_ERR_MSG });
    await expect(erpRouter.createCaller(ctx).customers.remove({ id: 1 } as never)).rejects.toMatchObject({ message: IMPERSONATION_BLOCKED_ERR_MSG });
  });

  it("ends the session, invalidating it, and writes an end audit entry with duration", async () => {
    const staffCaller = adminRouter.createCaller(operatorContext(staff.user));
    const result = await staffCaller.impersonation.start({ userId: target.user.id, reason: "Second look" });
    const impersonationCtx = await contextFromToken(result.token);

    await adminRouter.createCaller(impersonationCtx).impersonation.end();

    await expect(sdk.authenticateRequest(fakeRequest(result.token))).rejects.toThrow();

    const db = await getDb();
    const endedLogs = await db!.select().from(auditLogs).where(eq(auditLogs.action, "IMPERSONATION_ENDED"));
    const match = endedLogs.find(row => row.actorId === staff.user.id && row.entityId === target.user.id);
    expect(match).toBeDefined();
    const details = JSON.parse(match!.detailsJson || "{}");
    expect(typeof details.durationMs).toBe("number");
  });

  it("lets an impersonation session through a suspended target org while a normal session there is blocked", async () => {
    const db = await getDb();
    await db!.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, target.organization.id));

    try {
      await expect(erpRouter.createCaller(contextFor(target.user)).customers.list({ search: "" })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: ORG_SUSPENDED_ERR_MSG,
      });

      const result = await adminRouter.createCaller(operatorContext(staff.user)).impersonation.start({ userId: target.user.id, reason: "Support during suspension" });
      const impersonationCtx = await contextFromToken(result.token);
      await expect(erpRouter.createCaller(impersonationCtx).customers.list({ search: "" })).resolves.toBeInstanceOf(Array);
    } finally {
      await db!.update(organizations).set({ status: "active" }).where(eq(organizations.id, target.organization.id));
    }
  });

  it("cannot be nested: an impersonation session cannot itself start another impersonation", async () => {
    const result = await adminRouter.createCaller(operatorContext(staff.user)).impersonation.start({ userId: target.user.id, reason: "Nesting check" });
    const impersonationCtx = await contextFromToken(result.token);

    await expect(
      adminRouter.createCaller(impersonationCtx).impersonation.start({ userId: otherTarget.user.id, reason: "Should never work" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
