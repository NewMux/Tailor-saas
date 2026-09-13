import type { Logger } from "drizzle-orm";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { organizations, shopSettings, staffAccessInvites, userBusinessRoles, userCustomRoles, users, type InsertUser } from "../drizzle/schema";
import { BILLING, ENV } from "./_core/env";

let database: ReturnType<typeof drizzle> | null = null;

// Every table that must always be filtered/stamped by organizationId.
// "users" is deliberately excluded: login/session/invite-acceptance queries
// legitimately look users up before an organization is known.
const TENANT_TABLES = [
  "userBusinessRoles", "customRoles", "userCustomRoles", "pendingAccessRequests", "staffAccessInvites",
  "shopSettings", "customers", "measurementProfiles", "tailoringOrders", "inventoryItems", "stockMovements",
  "services", "sales", "saleItems", "posSessions", "posOrders", "posPayments", "discountCodes", "invoices",
  "invoicePayments", "invoiceDeliveries", "customerBalanceDeliveries", "staffProfiles", "staffDocuments",
  "attendance", "performanceRecords", "salaryPayouts", "auditLogs",
];

/**
 * Cheap regex-style safety net, not a full SQL parser: fails a query that
 * touches a known tenant table without an "organizationId" predicate
 * anywhere in the statement. Only active in tests / TENANT_GUARD=1 so it
 * never affects production if a table legitimately needs an escape hatch.
 */
class TenantGuardLogger implements Logger {
  logQuery(query: string) {
    const touchesTenantTable = TENANT_TABLES.some(table => query.includes(`"${table}"`));
    if (touchesTenantTable && !query.includes("organizationId")) {
      throw new Error(`[TenantGuard] Query touches a tenant table without an organizationId filter:\n${query}`);
    }
  }
}

const tenantGuardEnabled = process.env.NODE_ENV === "test" || process.env.TENANT_GUARD === "1";

export async function getDb() {
  if (!database && ENV.databaseUrl) {
    const client = postgres(ENV.databaseUrl, { prepare: false });
    database = tenantGuardEnabled ? drizzle(client, { logger: new TenantGuardLogger() }) : drizzle(client);
  }
  return database;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  return (
    await db.select().from(users).where(eq(users.id, userId)).limit(1)
  )[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (
    await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
  )[0];
}

function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "shop";
}

/**
 * Creates a brand-new organization and its owning admin user in one
 * transaction. The user row is inserted first with organizationId left
 * unset (see the comment on that column in drizzle/schema.ts) because the
 * organization it will own doesn't exist yet; both rows are only ever
 * visible to other transactions once organizationId has been set, so no
 * committed user is ever left without one.
 *
 * The organization starts on a free trial: trialEndsAt is stamped here, in
 * the same transaction, so no signup can ever produce an organization with a
 * "trialing" status and no trial deadline (which evaluateBillingAccess would
 * treat as an expired trial and lock immediately).
 */
export async function createOrganizationWithOwner(orgName: string, newUser: Omit<InsertUser, "organizationId" | "role">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [user] = await tx.insert(users).values({ ...newUser, role: "admin" }).returning();
    if (!user) throw new Error("Unable to create the account");

    const baseSlug = slugify(orgName);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = (await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1))[0];
      if (!collision) break;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const trialEndsAt = new Date(Date.now() + BILLING.trialDays * 24 * 60 * 60 * 1000);
    const [organization] = await tx
      .insert(organizations)
      .values({ slug, name: orgName, ownerId: user.id, subscriptionStatus: "trialing", trialEndsAt })
      .returning();
    if (!organization) throw new Error("Unable to create the organization");

    await tx.update(users).set({ organizationId: organization.id }).where(eq(users.id, user.id));
    await tx.insert(userBusinessRoles).values({ userId: user.id, organizationId: organization.id, role: "admin", isActive: true });
    await tx.insert(shopSettings).values({ organizationId: organization.id, shopName: orgName });

    return { user: { ...user, organizationId: organization.id }, organization };
  });
}

export async function getActiveInviteByTokenHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const now = new Date();
  return (
    await db
      .select()
      .from(staffAccessInvites)
      .where(
        and(
          eq(staffAccessInvites.tokenHash, tokenHash),
          eq(staffAccessInvites.isActive, true),
          sql`${staffAccessInvites.acceptedByUserId} IS NULL`,
          sql`${staffAccessInvites.expiresAt} IS NOT NULL AND ${staffAccessInvites.expiresAt} > ${now}`
        )
      )
      .limit(1)
  )[0];
}

/**
 * Joins an existing organization via a valid invite: creates the new user
 * already scoped to that organization, assigns the invited custom role, and
 * marks the invite accepted, all atomically.
 */
export async function acceptInviteAndCreateUser(inviteId: number, newUser: Omit<InsertUser, "organizationId" | "role">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const now = new Date();
    const [invite] = await tx
      .select()
      .from(staffAccessInvites)
      .where(and(eq(staffAccessInvites.id, inviteId), eq(staffAccessInvites.isActive, true), sql`${staffAccessInvites.acceptedByUserId} IS NULL`))
      .limit(1);
    if (!invite || !invite.expiresAt || invite.expiresAt <= now) {
      throw new Error("This invite link is invalid or has expired.");
    }

    const [user] = await tx
      .insert(users)
      .values({ ...newUser, role: "user", organizationId: invite.organizationId })
      .returning();
    if (!user) throw new Error("Unable to create the account");

    await tx.insert(userCustomRoles).values({
      userId: user.id,
      organizationId: invite.organizationId,
      customRoleId: invite.customRoleId,
      isActive: true,
      updatedBy: invite.invitedBy,
    });
    await tx.update(staffAccessInvites).set({ acceptedByUserId: user.id, acceptedAt: now }).where(eq(staffAccessInvites.id, invite.id));

    return { user, organizationId: invite.organizationId };
  });
}
