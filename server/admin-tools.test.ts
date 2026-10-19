/** The /ops verification tools: user search and access review, sessions, audit search, security status. */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { authSessions, inventoryItems, platformAuditLogs, platformStaff, services, userBusinessRoles, users } from "../drizzle/schema";
import { adminRouter } from "./admin";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import { operatorContext } from "./testing/contexts";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("operator verification tools (real Postgres)", () => {
  const stamp = Date.now();
  let root: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let support: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let shopA: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let shopB: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  const rootApi = () => adminRouter.createCaller(operatorContext(root.user));
  const supportApi = () => adminRouter.createCaller(operatorContext(support.user));

  beforeAll(async () => {
    const mk = (tag: string) => createOrganizationWithOwner(`Tools Org ${tag} ${stamp}`, { openId: `tl-${tag}-${stamp}`, name: `Tools ${tag}`, email: `tl-${tag}-${stamp}@example.com`, passwordHash: "$scrypt$x$y", loginMethod: "local" });
    [root, support, shopA, shopB] = await Promise.all([mk("root"), mk("support"), mk("a"), mk("b")]);
    const db = (await getDb())!;
    await db.insert(platformStaff).values([
      { userId: root.user.id, role: "superadmin", isActive: true },
      { userId: support.user.id, role: "support", isActive: true },
    ]);
  });

  it("finds users across shops by email or name, for any operator", async () => {
    const found = await supportApi().users.search({ query: `tl-a-${stamp}` });
    expect(found.map(row => row.id)).toEqual([shopA.user.id]);
    expect(found[0]).toMatchObject({ organizationName: `Tools Org a ${stamp}` });
    expect(await supportApi().users.search({ query: "%" })).toHaveLength(0); // wildcard characters are literal
  });

  it("shows an access review that agrees with what the user can actually do", async () => {
    const db = (await getDb())!;
    const [clerk] = await db.insert(users).values({ openId: `tl-clerk-${stamp}`, name: "Clerk", email: `tl-clerk-${stamp}@example.com`, loginMethod: "local", role: "user", organizationId: shopA.organization.id }).returning();
    await db.insert(userBusinessRoles).values({ userId: clerk!.id, organizationId: shopA.organization.id, role: "tailor", isActive: true });
    const detail = await supportApi().users.detail({ userId: clerk!.id });
    expect(detail.businessRole).toMatchObject({ role: "tailor", isPlaceholder: false });
    const can = Object.fromEntries(detail.effective.map(row => [row.label, row.allowed]));
    expect(can["Tailoring orders"]).toBe(true);
    expect(can["Payroll and staff documents"]).toBe(false);
    expect(can["Administer the shop"]).toBe(false);
    // The resolver the review uses is the one the routes use.
    await expect(erpRouter.createCaller({ user: clerk!, req: {} as never, res: {} as never }).staff.attendanceHistory()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await supportApi().users.detail({ userId: shopA.user.id })).isOwner).toBe(true);
  });

  it("lets only superadmins with a recent confirmation sign someone out, and audits it", async () => {
    const db = (await getDb())!;
    await db.insert(authSessions).values({ tokenHash: `tools-session-${stamp}`, userId: shopB.user.id, expiresAt: new Date(Date.now() + 60_000) });
    await expect(supportApi().users.signOut({ userId: shopB.user.id, reason: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminRouter.createCaller(operatorContext(root.user, { reauth: false })).users.signOut({ userId: shopB.user.id, reason: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await rootApi().users.signOut({ userId: shopB.user.id, reason: "Reported compromised" });
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, shopB.user.id))).toHaveLength(0);
    const trail = await db.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, "USER_SIGNED_OUT"), eq(platformAuditLogs.targetId, shopB.user.id)));
    expect(trail).toHaveLength(1);
  });

  it("revokes one session or all others, never the caller's own", async () => {
    const db = (await getDb())!;
    const [mine] = await db.insert(authSessions).values({ tokenHash: `tools-mine-${stamp}`, userId: root.user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
    const [other] = await db.insert(authSessions).values({ tokenHash: `tools-other-${stamp}`, userId: shopA.user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
    const ctx = { ...operatorContext(root.user), session: { id: mine!.id, createdAt: new Date(), reauthAt: new Date() } };
    const api = adminRouter.createCaller(ctx);
    expect((await api.sessions.list()).some(row => row.id === other!.id)).toBe(true);
    const result = await api.sessions.revokeAll({ reason: "Credential exposure drill" });
    expect(result.revoked).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, mine!.id))).toHaveLength(1);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, other!.id))).toHaveLength(0);
  });

  it("searches tenant and platform audit trails and isolates impersonated actions", async () => {
    const db = (await getDb())!;
    const { auditLogs } = await import("../drizzle/schema");
    await db.insert(auditLogs).values([
      { organizationId: shopA.organization.id, actorId: shopA.user.id, action: "TOOLS_PLAIN", entityType: "x" },
      { organizationId: shopA.organization.id, actorId: shopA.user.id, impersonatedBy: root.user.id, action: "TOOLS_IMPERSONATED", entityType: "x" },
    ]);
    const all = await supportApi().audit.search({ organizationId: shopA.organization.id, limit: 100 });
    expect(all.rows.map(row => row.action)).toEqual(expect.arrayContaining(["TOOLS_PLAIN", "TOOLS_IMPERSONATED"]));
    const only = await supportApi().audit.search({ organizationId: shopA.organization.id, impersonatedOnly: true });
    expect(only.rows.every(row => row.impersonatedBy === root.user.id)).toBe(true);
    expect(only.rows.some(row => row.action === "TOOLS_IMPERSONATED")).toBe(true);
    const platform = await supportApi().audit.search({ source: "platform", action: "USER_SIGNED_OUT" });
    expect(platform.rows.every(row => row.source === "platform")).toBe(true);
  });

  it("reports security status to superadmins only, and finds a poisoned cross-tenant reference", async () => {
    await expect(supportApi().security.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const db = (await getDb())!;
    const [item] = await db.insert(inventoryItems).values({ organizationId: shopB.organization.id, code: `TL-${stamp}`, name: "B stock", inventoryType: "material", category: "fabric", color: "x", unit: "m", costPerUnit: "1", salePrice: "1", quantity: "1" } as never).returning();
    const [poisoned] = await db.insert(services).values({ organizationId: shopA.organization.id, sku: `TLS-${stamp}`, name: "Poisoned", category: "fabric", unitPrice: "1.000", inventoryItemId: item!.id }).returning();
    const status = await rootApi().security.status().finally(async () => {
      // The test database is shared; leave no cross-tenant link behind.
      await db.delete(services).where(and(eq(services.id, poisoned!.id), eq(services.organizationId, shopA.organization.id)));
    });
    expect(status.database.tablesWithoutRls).toEqual([]);
    expect(status.database.repoMigrations).toBeGreaterThanOrEqual(19);
    expect(status.database.appliedMigrations).toBeGreaterThanOrEqual(status.database.repoMigrations);
    const services_ = status.referenceViolations.find(row => row.child === "services" && row.column === "inventoryItemId");
    expect(services_!.rows).toBeGreaterThanOrEqual(1);
    expect(status.operators.activeSuperadmins).toBeGreaterThanOrEqual(1);
  });
});
