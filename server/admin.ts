import { TRPCError } from "@trpc/server";
import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, authSessions, organizations, platformStaff, users } from "../drizzle/schema";
import { createImpersonationSession, endImpersonationSession, IMPERSONATION_TTL_MS, sessionTokenFromRequest } from "./_core/localAuth";
import { platformProcedure, protectedProcedure, router, superadminProcedure } from "./_core/trpc";
import { getDb, getUserByEmail, getUserById } from "./db";

const PLATFORM_AUDIT_ACTIONS = ["ORG_SUSPENDED", "ORG_REACTIVATED", "IMPERSONATION_STARTED", "IMPERSONATION_ENDED"] as const;

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
      // TODO(billing): replace once a subscriptions table exists.
      planStatus: "unmetered" as const,
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
          .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt, lastSignedIn: users.lastSignedIn })
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

      return { organization, users: orgUsers, recentAuditLogs, planStatus: "unmetered" as const };
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
