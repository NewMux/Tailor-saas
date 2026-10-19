/** Operator (platform staff) management: invites, guard rails, step-up, audit. Real Postgres. */
import { REAUTH_REQUIRED_ERR_MSG } from "@shared/const";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { authSessions, platformAuditLogs, platformStaff, users } from "../drizzle/schema";
import { adminRouter, assertAnotherSuperadminRemains } from "./admin";
import { createOrganizationWithOwner, getDb } from "./db";
import { operatorContext } from "./testing/contexts";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("operator access (real Postgres)", () => {
  const stamp = Date.now();
  let root: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let support: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  const asRoot = () => adminRouter.createCaller(operatorContext(root.user));

  beforeAll(async () => {
    const db = (await getDb())!;
    const mk = (tag: string) => createOrganizationWithOwner(`Operator Org ${tag} ${stamp}`, { openId: `op-${tag}-${stamp}`, name: `Operator ${tag}`, email: `op-${tag}-${stamp}@example.com`, passwordHash: "$scrypt$x$y", loginMethod: "local" });
    root = await mk("root");
    support = await mk("support");
    await db.insert(platformStaff).values([
      { userId: root.user.id, role: "superadmin", isActive: true },
      { userId: support.user.id, role: "support", isActive: true },
    ]);
  });

  it("invites a platform-only operator with a setup link and audits it", async () => {
    const email = `op-new-${stamp}@example.com`;
    const result = await asRoot().staff.invite({ name: "New Operator", email, role: "support", reason: "Joining the support rota" });
    expect(result.setupUrl).toContain("reset_token=");

    const db = (await getDb())!;
    const [created] = await db.select().from(users).where(eq(users.email, email));
    expect(created.organizationId).toBeNull();
    expect(created.passwordHash).toBeNull();
    const [staffRow] = await db.select().from(platformStaff).where(eq(platformStaff.userId, created.id));
    expect(staffRow).toMatchObject({ role: "support", isActive: true, grantedBy: root.user.id });
    const trail = await db.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, "STAFF_INVITED"), eq(platformAuditLogs.targetId, created.id)));
    expect(trail).toHaveLength(1);
    expect(trail[0].actorId).toBe(root.user.id);
  });

  it("refuses an invite for an address that already has an account", async () => {
    await expect(asRoot().staff.invite({ name: "Dup", email: root.user.email!, role: "support", reason: "dup" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("only superadmins can invite, and only with a recent password confirmation", async () => {
    await expect(adminRouter.createCaller(operatorContext(support.user)).staff.invite({ name: "X Y", email: `x-${stamp}@example.com`, role: "support", reason: "no" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      adminRouter.createCaller(operatorContext(root.user, { reauth: false })).staff.invite({ name: "X Y", email: `y-${stamp}@example.com`, role: "support", reason: "no" })
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: REAUTH_REQUIRED_ERR_MSG });
  });

  it("refuses to grant, change or remove your own access", async () => {
    await expect(asRoot().staff.revoke({ userId: root.user.id, reason: "oops" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(asRoot().staff.setRole({ userId: root.user.id, role: "support", reason: "oops" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(asRoot().staff.grant({ email: root.user.email!, role: "support", reason: "oops" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("will not grant access to an account that has not set a password", async () => {
    const pending = await createOrganizationWithOwner(`Pending Org ${stamp}`, { openId: `op-pending-${stamp}`, name: "Pending", email: `op-pending-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    await expect(asRoot().staff.grant({ email: pending.user.email!, role: "support", reason: "too early" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("changes a role, signs the person out, and audits the change", async () => {
    const db = (await getDb())!;
    await db.insert(authSessions).values({ tokenHash: `op-session-${stamp}`, userId: support.user.id, expiresAt: new Date(Date.now() + 60_000) });
    await asRoot().staff.setRole({ userId: support.user.id, role: "superadmin", reason: "Promoted" });
    const [row] = await db.select().from(platformStaff).where(eq(platformStaff.userId, support.user.id));
    expect(row.role).toBe("superadmin");
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, support.user.id))).toHaveLength(0);
    const trail = await db.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, "STAFF_ROLE_CHANGED"), eq(platformAuditLogs.targetId, support.user.id)));
    expect(JSON.parse(trail[0].detailsJson!)).toMatchObject({ from: "support", to: "superadmin" });
    await asRoot().staff.setRole({ userId: support.user.id, role: "support", reason: "Back to support" });
  });

  it("never lets the last active superadmin with a password be removed", async () => {
    const db = (await getDb())!;
    class Rollback extends Error {}
    await expect(
      db.transaction(async tx => {
        // Other test files leave superadmins behind; make `root` the only one for this transaction.
        await tx.update(platformStaff).set({ isActive: false }).where(and(eq(platformStaff.role, "superadmin")));
        await tx.update(platformStaff).set({ isActive: true }).where(eq(platformStaff.userId, root.user.id));
        let refused: unknown;
        try {
          await assertAnotherSuperadminRemains(tx as never, root.user.id);
        } catch (error) {
          refused = error;
        }
        expect(refused).toMatchObject({ code: "BAD_REQUEST" });
        // With a second one present, removing root is allowed.
        await tx.update(platformStaff).set({ role: "superadmin", isActive: true }).where(eq(platformStaff.userId, support.user.id));
        await expect(assertAnotherSuperadminRemains(tx as never, root.user.id)).resolves.toBeUndefined();
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);
  });
});
