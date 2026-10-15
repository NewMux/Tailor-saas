import { TRPCError } from "@trpc/server";
import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, authSessions, organizations, platformStaff, users } from "../drizzle/schema";
import { createAccountSetupLink, createImpersonationSession, endImpersonationSession, IMPERSONATION_TTL_MS, revokeImpersonationSessionsBy, sessionTokenFromRequest } from "./_core/localAuth";
import { createShopWithOwner, ShopOnboardingError } from "./_core/shopOnboarding";
import { appBaseUrl } from "./_core/urls";
import { platformProcedure, protectedProcedure, router, superadminProcedure } from "./_core/trpc";
import { getDb, getPlatformStaffByUserId, getUserByEmail, getUserById } from "./db";
import { billingAccess } from "./billing/access";
import { isBillingEnabled } from "./_core/env";

const PLATFORM_AUDIT_ACTIONS = [
  "ORG_CREATED",
  "OWNER_SETUP_LINK_CREATED",
  "ORG_SUSPENDED",
  "ORG_REACTIVATED",
  "IMPERSONATION_STARTED",
  "IMPERSONATION_ENDED",
  "BILLING_EXEMPT_SET",
  "BILLING_TRIAL_EXTENDED",
] as const;

/** Billing state as shown in the ops console, e.g. "trialing", "trial_expired", "exempt". */
function planStatus(organization: Parameters<typeof billingAccess>[0]) {
  return billingAccess(organization, new Date(), isBillingEnabled()).reason;
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

// Note on TenantGuardLogger (server/db.ts): it's a substring check that
// throws in tests if a query touches a TENANT_TABLES table without the
// literal string "organizationId" appearing in the SQL. organizations/users
// queries are exempt (not tenant tables), but a cross-org query against
// auditLogs (below) must select/group by organizationId - which the UI
// needs anyway to attribute each event to an organization - so this falls
// out naturally. Do not "fix" a guard failure here by disabling the guard.

async function audit(organizationId: number, actorId: number, action: string, entityType: string, entityId?: number, details?: unknown) {
  const db = await dbOrThrow();
  await db.insert(auditLogs).values({
    organizationId,
    actorId,
    action,
    entityType,
    entityId,
    detailsJson: details ? JSON.stringify(details) : null,
  });
}

const impersonationRouter = router({
  start: superadminProcedure
    .input(z.object({ userId: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const targetUser = await getUserById(input.userId);
      if (!targetUser || !targetUser.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That user does not belong to an organization." });
      }
      // Impersonation is for seeing a shop user's view, never for borrowing
      // another operator's (or your own) platform access.
      if (targetUser.id === ctx.user.id || (await getPlatformStaffByUserId(targetUser.id))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Platform staff accounts cannot be impersonated." });
      }

      const token = await createImpersonationSession(targetUser.id, ctx.user.id);
      await audit(targetUser.organizationId, ctx.user.id, "IMPERSONATION_STARTED", "user", targetUser.id, {
        reason: input.reason,
        platformStaffEmail: ctx.user.email,
      });

      return {
        token,
        expiresInMs: IMPERSONATION_TTL_MS,
        target: { id: targetUser.id, name: targetUser.name, email: targetUser.email, organizationId: targetUser.organizationId },
      };
    }),

  end: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.impersonation) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This session is not an impersonation session." });
    }
    if (!ctx.user.organizationId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Your account is not linked to an organization." });
    }

    const token = sessionTokenFromRequest(ctx.req);
    const session = token ? await endImpersonationSession(token) : undefined;
    const durationMs = session ? Date.now() - session.createdAt.getTime() : null;

    await audit(ctx.user.organizationId, ctx.impersonation.platformStaffUserId, "IMPERSONATION_ENDED", "user", ctx.user.id, { durationMs });

    return { ok: true } as const;
  }),
});

const organizationsRouter = router({
  list: platformProcedure.query(async () => {
    const db = await dbOrThrow();
    const [orgs, userCounts, lastActivity] = await Promise.all([
      db.select().from(organizations).orderBy(desc(organizations.createdAt)),
      db
        .select({ organizationId: users.organizationId, count: sql<number>`count(*)` })
        .from(users)
        .where(isNotNull(users.organizationId))
        .groupBy(users.organizationId),
      db
        .select({ organizationId: auditLogs.organizationId, lastActivityAt: sql<string>`max(${auditLogs.createdAt})` })
        .from(auditLogs)
        .groupBy(auditLogs.organizationId),
    ]);
    const userCountByOrg = new Map(userCounts.map(row => [row.organizationId, Number(row.count)]));
    const lastActivityByOrg = new Map(lastActivity.map(row => [row.organizationId, row.lastActivityAt]));

    return orgs.map(organization => ({
      ...organization,
      userCount: userCountByOrg.get(organization.id) ?? 0,
      lastActivityAt: lastActivityByOrg.get(organization.id) ?? null,
      planStatus: planStatus(organization),
    }));
  }),

  detail: platformProcedure
    .input(z.object({ organizationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await dbOrThrow();
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
      if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });

      const [orgUsers, recentAuditLogs] = await Promise.all([
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            createdAt: users.createdAt,
            lastSignedIn: users.lastSignedIn,
            // Whether they've finished account setup; never the hash itself.
            hasPassword: sql<boolean>`${users.passwordHash} is not null`,
          })
          .from(users)
          .where(eq(users.organizationId, input.organizationId))
          .orderBy(desc(users.createdAt)),
        db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.organizationId, input.organizationId))
          .orderBy(desc(auditLogs.createdAt))
          .limit(50),
      ]);

      return { organization, users: orgUsers, recentAuditLogs, planStatus: planStatus(organization) };
    }),

  // Invite-only onboarding: the only way a new shop comes into existence.
  // The owner gets a one-time link to choose their password; it's emailed
  // when email is configured and always returned so staff can hand it over.
  create: superadminProcedure
    .input(
      z.object({
        shopName: z.string().trim().min(2).max(160),
        ownerName: z.string().trim().min(2).max(160),
        ownerEmail: z.string().trim().toLowerCase().email().max(320),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let created: Awaited<ReturnType<typeof createShopWithOwner>>;
      try {
        created = await createShopWithOwner(input, appBaseUrl(ctx.req));
      } catch (error) {
        if (error instanceof ShopOnboardingError) throw new TRPCError({ code: "CONFLICT", message: error.message });
        throw error;
      }
      await audit(created.organization.id, ctx.user.id, "ORG_CREATED", "organization", created.organization.id, {
        ownerEmail: input.ownerEmail,
        setupEmailed: created.emailed,
      });
      return { organizationId: created.organization.id, setupUrl: created.setupUrl, emailed: created.emailed };
    }),

  // Re-issues the owner's setup link (e.g. it expired before they used it).
  // Only while they have no password: once they do, "Forgot password?" is
  // the way back in, and staff must not be able to take over the account.
  ownerSetupLink: superadminProcedure
    .input(z.object({ organizationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
      if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
      const owner = await getUserById(organization.ownerId);
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "This organization's owner account was not found." });
      if (owner.passwordHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The owner has already set a password. They can use \"Forgot password?\" to reset it." });
      }
      const setupUrl = await createAccountSetupLink(owner.id, appBaseUrl(ctx.req));
      await audit(organization.id, ctx.user.id, "OWNER_SETUP_LINK_CREATED", "user", owner.id);
      return { setupUrl };
    }),

  suspend: superadminProcedure
    .input(z.object({ organizationId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [organization] = await db
        .update(organizations)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });

      // Kill any already-open sessions immediately, rather than waiting for
      // each one to happen to fail on its next request.
      const orgUserIds = (await db.select({ id: users.id }).from(users).where(eq(users.organizationId, organization.id))).map(row => row.id);
      if (orgUserIds.length > 0) {
        await db.delete(authSessions).where(inArray(authSessions.userId, orgUserIds));
      }

      await audit(organization.id, ctx.user.id, "ORG_SUSPENDED", "organization", organization.id, { reason: input.reason });
      return organization;
    }),

  reactivate: superadminProcedure
    .input(z.object({ organizationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [organization] = await db
        .update(organizations)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });

      await audit(organization.id, ctx.user.id, "ORG_REACTIVATED", "organization", organization.id);
      return organization;
    }),

  // Comp an organization (internal demo, partner, manual invoice) so it is
  // never made read-only for non-payment, or remove that exemption.
  setBillingExempt: superadminProcedure
    .input(z.object({ organizationId: z.number().int().positive(), exempt: z.boolean(), reason: z.string().trim().min(3).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [organization] = await db
        .update(organizations)
        .set({ billingExempt: input.exempt, updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
      await audit(organization.id, ctx.user.id, "BILLING_EXEMPT_SET", "organization", organization.id, { exempt: input.exempt, reason: input.reason });
      return organization;
    }),

  // Gives a shop more trial time, e.g. while it finishes onboarding. Counts
  // from the later of now and the current trial end, and puts a lapsed
  // (non-paying) organization back into the trial.
  extendTrial: superadminProcedure
    .input(z.object({ organizationId: z.number().int().positive(), days: z.number().int().min(1).max(365) }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [current] = await db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
      if (current.subscriptionStatus === "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This organization already has an active paid subscription." });
      }
      const from = Math.max(Date.now(), current.trialEndsAt?.getTime() ?? 0);
      const trialEndsAt = new Date(from + input.days * 24 * 60 * 60 * 1000);
      const [organization] = await db
        .update(organizations)
        .set({ subscriptionStatus: "trialing", trialEndsAt, updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      await audit(current.id, ctx.user.id, "BILLING_TRIAL_EXTENDED", "organization", current.id, {
        days: input.days,
        previousStatus: current.subscriptionStatus,
        trialEndsAt: trialEndsAt.toISOString(),
      });
      return organization!;
    }),
});

const staffRouter = router({
  list: superadminProcedure.query(async () => {
    const db = await dbOrThrow();
    return db
      .select({
        id: platformStaff.id,
        userId: platformStaff.userId,
        role: platformStaff.role,
        isActive: platformStaff.isActive,
        name: users.name,
        email: users.email,
        createdAt: platformStaff.createdAt,
      })
      .from(platformStaff)
      .innerJoin(users, eq(users.id, platformStaff.userId))
      .orderBy(desc(platformStaff.createdAt));
  }),

  grant: superadminProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["support", "superadmin"]) }))
    .mutation(async ({ ctx, input }) => {
      const target = await getUserByEmail(input.email);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "No account found for that email." });

      const db = await dbOrThrow();
      await db
        .insert(platformStaff)
        .values({ userId: target.id, role: input.role, isActive: true, grantedBy: ctx.user.id })
        .onConflictDoUpdate({ target: platformStaff.userId, set: { role: input.role, isActive: true, updatedAt: new Date() } });

      return { ok: true } as const;
    }),

  revoke: superadminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await dbOrThrow();
      const [updated] = await db
        .update(platformStaff)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(platformStaff.userId, input.userId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "That user is not platform staff." });
      await revokeImpersonationSessionsBy(input.userId);

      return { ok: true } as const;
    }),
});

export const adminRouter = router({
  organizations: organizationsRouter,
  staff: staffRouter,
  impersonation: impersonationRouter,
  auditFeed: platformProcedure.query(async () => {
    const db = await dbOrThrow();
    return db
      .select()
      .from(auditLogs)
      .where(inArray(auditLogs.action, PLATFORM_AUDIT_ACTIONS))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
  }),
});
