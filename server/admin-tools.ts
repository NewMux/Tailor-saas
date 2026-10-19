import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import journal from "../drizzle/meta/_journal.json";
import {
  authEvents,
  authSessions,
  auditLogs,
  customRoles,
  organizations,
  platformAuditLogs,
  platformStaff,
  userBusinessRoles,
  userCustomRoles,
  users,
} from "../drizzle/schema";
import {
  adminRoles,
  catalogRoles,
  customerReadRoles,
  customerWriteRoles,
  dashboardRoles,
  hasAccess,
  inventoryRoles,
  measurementWriteRoles,
  payrollRoles,
  salesRoles,
  staffDirectoryRoles,
  tailoringRoles,
} from "./_core/access";
import { recordAuthEvent } from "./_core/authEvents";
import { ENV, isBillingEnabled, isEmailConfigured, isS3Configured } from "./_core/env";
import { revokeAllSessionsForUser } from "./_core/localAuth";
import { platformAudit } from "./_core/platformAudit";
import { highRiskProcedure, platformProcedure, router, superadminProcedure } from "./_core/trpc";
import { getDb } from "./db";

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

const reason = z.string().trim().min(3).max(300);

/** What the shared resolver says a user can do, so this view can never disagree with runtime. */
const CAPABILITIES = {
  "Administer the shop": adminRoles,
  "Sales, invoices and customer ledger": salesRoles,
  "Product catalog": catalogRoles,
  "Inventory": inventoryRoles,
  "Payroll and staff documents": payrollRoles,
  "Tailoring orders": tailoringRoles,
  "Staff directory": staffDirectoryRoles,
  "Dashboard": dashboardRoles,
  "View customers": customerReadRoles,
  "Edit customers": customerWriteRoles,
  "Take measurements": measurementWriteRoles,
} as const;

const usersRouter = router({
  search: platformProcedure
    .input(z.object({ query: z.string().trim().max(120).default(""), limit: z.number().int().min(1).max(50).default(25) }))
    .query(async ({ input }) => {
      const db = await dbOrThrow();
      const pattern = `%${input.query.replace(/[\\%_]/g, match => `\\${match}`)}%`;
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          organizationId: users.organizationId,
          organizationName: organizations.name,
          lastSignedIn: users.lastSignedIn,
          hasPassword: sql<boolean>`${users.passwordHash} is not null`,
          platformRole: platformStaff.role,
          platformActive: platformStaff.isActive,
        })
        .from(users)
        .leftJoin(organizations, eq(organizations.id, users.organizationId))
        .leftJoin(platformStaff, eq(platformStaff.userId, users.id))
        .where(input.query ? or(ilike(users.email, pattern), ilike(users.name, pattern)) : undefined)
        .orderBy(desc(users.createdAt))
        .limit(input.limit);
      return rows;
    }),

  detail: platformProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await dbOrThrow();
    const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
    const [organization] = user.organizationId
      ? await db.select({ id: organizations.id, name: organizations.name, status: organizations.status, ownerId: organizations.ownerId }).from(organizations).where(eq(organizations.id, user.organizationId)).limit(1)
      : [];
    const orgId = user.organizationId;
    const [businessRole] = orgId
      ? await db.select({ role: userBusinessRoles.role, isActive: userBusinessRoles.isActive, isPlaceholder: userBusinessRoles.isPlaceholder }).from(userBusinessRoles).where(and(eq(userBusinessRoles.userId, user.id), eq(userBusinessRoles.organizationId, orgId))).limit(1)
      : [];
    const [custom] = orgId
      ? await db
          .select({ name: customRoles.name, permissions: customRoles.permissionsJson, assignmentActive: userCustomRoles.isActive, roleActive: customRoles.isActive })
          .from(userCustomRoles)
          .innerJoin(customRoles, eq(customRoles.id, userCustomRoles.customRoleId))
          .where(and(eq(userCustomRoles.userId, user.id), eq(userCustomRoles.organizationId, orgId), eq(customRoles.organizationId, orgId)))
          .limit(1)
      : [];
    const [staff] = await db.select({ role: platformStaff.role, isActive: platformStaff.isActive }).from(platformStaff).where(eq(platformStaff.userId, user.id)).limit(1);
    const sessions = await db
      .select({ id: authSessions.id, createdAt: authSessions.createdAt, lastUsedAt: authSessions.lastUsedAt, expiresAt: authSessions.expiresAt, impersonatedBy: authSessions.impersonatedBy, mode: authSessions.impersonationMode })
      .from(authSessions)
      .where(eq(authSessions.userId, user.id))
      .orderBy(desc(authSessions.lastUsedAt))
      .limit(20);
    const events = await db
      .select({ id: authEvents.id, type: authEvents.type, ip: authEvents.ip, userAgent: authEvents.userAgent, createdAt: authEvents.createdAt })
      .from(authEvents)
      .where(eq(authEvents.userId, user.id))
      .orderBy(desc(authEvents.createdAt))
      .limit(20);

    const effective = orgId
      ? await Promise.all(Object.entries(CAPABILITIES).map(async ([label, roles]) => ({ label, allowed: await hasAccess(user.id, orgId, roles) })))
      : [];
    return {
      user: { id: user.id, name: user.name, email: user.email, organizationId: user.organizationId, lastSignedIn: user.lastSignedIn, createdAt: user.createdAt, hasPassword: user.passwordHash !== null },
      organization: organization ?? null,
      isOwner: Boolean(organization && organization.ownerId === user.id),
      businessRole: businessRole ?? null,
      customRole: custom ? { name: custom.name, permissions: custom.permissions, active: custom.assignmentActive && custom.roleActive } : null,
      platformStaff: staff ?? null,
      effective,
      sessions,
      events,
    };
  }),

  // Signs a person out everywhere, e.g. after reports of a compromised account.
  signOut: highRiskProcedure.input(z.object({ userId: z.number().int().positive(), reason })).mutation(async ({ ctx, input }) => {
    await revokeAllSessionsForUser(input.userId);
    await recordAuthEvent({ type: "session_revoked", userId: input.userId, req: ctx.req, details: { by: ctx.user.id } });
    await platformAudit({ actor: ctx.user, action: "USER_SIGNED_OUT", targetType: "user", targetId: input.userId, details: { reason: input.reason }, req: ctx.req });
    return { ok: true } as const;
  }),
});

const sessionsRouter = router({
  list: platformProcedure.query(async () => {
    const db = await dbOrThrow();
    return db
      .select({
        id: authSessions.id,
        userId: authSessions.userId,
        email: users.email,
        createdAt: authSessions.createdAt,
        lastUsedAt: authSessions.lastUsedAt,
        expiresAt: authSessions.expiresAt,
        impersonatedBy: authSessions.impersonatedBy,
        mode: authSessions.impersonationMode,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .orderBy(desc(authSessions.lastUsedAt))
      .limit(200);
  }),

  revoke: highRiskProcedure.input(z.object({ sessionId: z.number().int().positive(), reason })).mutation(async ({ ctx, input }) => {
    const db = await dbOrThrow();
    const deleted = await db.delete(authSessions).where(eq(authSessions.id, input.sessionId)).returning({ id: authSessions.id, userId: authSessions.userId });
    if (!deleted[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
    await platformAudit({ actor: ctx.user, action: "SESSION_REVOKED", targetType: "session", targetId: input.sessionId, details: { userId: deleted[0].userId, reason: input.reason }, req: ctx.req });
    return { ok: true } as const;
  }),

  // Everyone except the operator doing it, e.g. after a credential exposure.
  revokeAll: highRiskProcedure.input(z.object({ reason })).mutation(async ({ ctx, input }) => {
    const db = await dbOrThrow();
    const deleted = await db.delete(authSessions).where(ctx.session ? sql`${authSessions.id} <> ${ctx.session.id}` : undefined).returning({ id: authSessions.id });
    await platformAudit({ actor: ctx.user, action: "ALL_SESSIONS_REVOKED", targetType: "session", details: { count: deleted.length, reason: input.reason }, req: ctx.req });
    return { revoked: deleted.length };
  }),
});

const auditInput = z.object({
  source: z.enum(["all", "tenant", "platform"]).default("all"),
  organizationId: z.number().int().positive().optional(),
  actorId: z.number().int().positive().optional(),
  action: z.string().trim().max(100).optional(),
  impersonatedOnly: z.boolean().default(false),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Pagination: only entries older than this. */
  before: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

function parseDetails(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

const auditRouter = router({
  search: platformProcedure.input(auditInput).query(async ({ input }) => {
    const db = await dbOrThrow();
    const rows: Array<{ source: "tenant" | "platform"; id: number; createdAt: Date; organizationId: number | null; actorId: number | null; actorEmail: string | null; action: string; targetType: string; targetId: number | null; impersonatedBy: number | null; details: unknown }> = [];

    if (input.source !== "platform") {
      const filters = [
        input.organizationId ? eq(auditLogs.organizationId, input.organizationId) : undefined,
        input.actorId ? eq(auditLogs.actorId, input.actorId) : undefined,
        input.action ? eq(auditLogs.action, input.action) : undefined,
        input.impersonatedOnly ? isNotNull(auditLogs.impersonatedBy) : undefined,
        input.from ? gte(auditLogs.createdAt, input.from) : undefined,
        input.to ? lte(auditLogs.createdAt, input.to) : undefined,
        input.before ? lt(auditLogs.createdAt, input.before) : undefined,
      ].filter(Boolean);
      const tenant = await db.select().from(auditLogs).where(and(...filters)).orderBy(desc(auditLogs.createdAt)).limit(input.limit);
      for (const row of tenant) {
        rows.push({ source: "tenant", id: row.id, createdAt: row.createdAt, organizationId: row.organizationId, actorId: row.actorId, actorEmail: null, action: row.action, targetType: row.entityType, targetId: row.entityId, impersonatedBy: row.impersonatedBy, details: parseDetails(row.detailsJson) });
      }
    }
    if (input.source !== "tenant" && !input.impersonatedOnly) {
      const filters = [
        input.organizationId ? eq(platformAuditLogs.organizationId, input.organizationId) : undefined,
        input.actorId ? eq(platformAuditLogs.actorId, input.actorId) : undefined,
        input.action ? eq(platformAuditLogs.action, input.action) : undefined,
        input.from ? gte(platformAuditLogs.createdAt, input.from) : undefined,
        input.to ? lte(platformAuditLogs.createdAt, input.to) : undefined,
        input.before ? lt(platformAuditLogs.createdAt, input.before) : undefined,
      ].filter(Boolean);
      const platform = await db.select().from(platformAuditLogs).where(and(...filters)).orderBy(desc(platformAuditLogs.createdAt)).limit(input.limit);
      for (const row of platform) {
        rows.push({ source: "platform", id: row.id, createdAt: row.createdAt, organizationId: row.organizationId, actorId: row.actorId, actorEmail: row.actorEmail, action: row.action, targetType: row.targetType, targetId: row.targetId, impersonatedBy: null, details: parseDetails(row.detailsJson) });
      }
    }
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const page = rows.slice(0, input.limit);
    return { rows: page, nextBefore: page.length === input.limit ? page[page.length - 1]!.createdAt : null };
  }),
});

/** Child id columns that must point at a parent in the same organization. */
const REFERENCES = [
  { child: "services", column: "inventoryItemId", parent: "inventoryItems" },
  { child: "sales", column: "customerId", parent: "customers" },
  { child: "saleItems", column: "serviceId", parent: "services" },
  { child: "saleItems", column: "inventoryItemId", parent: "inventoryItems" },
  { child: "posOrders", column: "sessionId", parent: "posSessions" },
  { child: "posOrders", column: "customerId", parent: "customers" },
  { child: "measurementProfiles", column: "customerId", parent: "customers" },
  { child: "performanceRecords", column: "staffProfileId", parent: "staffProfiles" },
  { child: "attendance", column: "staffProfileId", parent: "staffProfiles" },
  { child: "attendance", column: "absenceDocumentId", parent: "staffDocuments" },
  { child: "staffDocuments", column: "staffProfileId", parent: "staffProfiles" },
] as const;

const securityRouter = router({
  status: superadminProcedure.query(async () => {
    const db = await dbOrThrow();
    const rlsRows = await db.execute<{ tablename: string; rowsecurity: boolean }>(sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`);
    const roleRows = await db.execute<{ rolname: string }>(sql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`);
    let apiGrants = 0;
    if (roleRows.length > 0) {
      const grants = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
      apiGrants = grants[0]?.n ?? 0;
    }
    let appliedMigrations: number | null = null;
    try {
      const applied = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      appliedMigrations = applied[0]?.n ?? null;
    } catch {
      appliedMigrations = null;
    }

    const staff = await db
      .select({ userId: platformStaff.userId, role: platformStaff.role, hasPassword: sql<boolean>`${users.passwordHash} is not null` })
      .from(platformStaff)
      .innerJoin(users, eq(users.id, platformStaff.userId))
      .where(eq(platformStaff.isActive, true));
    const activeSuperadmins = staff.filter(row => row.role === "superadmin" && row.hasPassword).length;

    const referenceViolations = [] as Array<{ child: string; column: string; parent: string; rows: number }>;
    for (const reference of REFERENCES) {
      const result = await db.execute<{ n: number }>(
        sql.raw(
          `select count(*)::int as n from "${reference.child}" c join "${reference.parent}" p on p.id = c."${reference.column}" where p."organizationId" <> c."organizationId"`
        )
      );
      referenceViolations.push({ ...reference, rows: result[0]?.n ?? 0 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [lockouts] = await db.select({ n: count() }).from(authEvents).where(and(eq(authEvents.type, "login_blocked"), gte(authEvents.createdAt, since)));
    const [failures] = await db.select({ n: count() }).from(authEvents).where(and(eq(authEvents.type, "login_failed"), gte(authEvents.createdAt, since)));
    const writeSessions = await db
      .select({ id: platformAuditLogs.id, actorId: platformAuditLogs.actorId, createdAt: platformAuditLogs.createdAt, detailsJson: platformAuditLogs.detailsJson })
      .from(platformAuditLogs)
      .where(and(eq(platformAuditLogs.action, "IMPERSONATION_STARTED"), gte(platformAuditLogs.createdAt, weekAgo)))
      .orderBy(desc(platformAuditLogs.createdAt))
      .limit(50);
    const writeStarts = writeSessions.filter(row => parseDetails(row.detailsJson) && (parseDetails(row.detailsJson) as { mode?: string }).mode === "write");

    // Operators signing in from an address they have not used before.
    const operatorIds = staff.map(row => row.userId);
    const newIpLogins: Array<{ userId: number; ip: string; at: Date }> = [];
    if (operatorIds.length) {
      const recent = await db.select({ userId: authEvents.userId, ip: authEvents.ip, createdAt: authEvents.createdAt }).from(authEvents).where(and(eq(authEvents.type, "login_success"), inArray(authEvents.userId, operatorIds), gte(authEvents.createdAt, weekAgo))).orderBy(desc(authEvents.createdAt)).limit(200);
      for (const login of recent) {
        if (!login.userId || !login.ip) continue;
        const [earlier] = await db.select({ n: count() }).from(authEvents).where(and(eq(authEvents.type, "login_success"), eq(authEvents.userId, login.userId), eq(authEvents.ip, login.ip), lt(authEvents.createdAt, login.createdAt)));
        if (Number(earlier?.n ?? 0) === 0) newIpLogins.push({ userId: login.userId, ip: login.ip, at: login.createdAt });
      }
    }

    const events = await db
      .select({ id: authEvents.id, type: authEvents.type, userId: authEvents.userId, ip: authEvents.ip, createdAt: authEvents.createdAt })
      .from(authEvents)
      .where(inArray(authEvents.type, ["login_failed", "login_blocked", "reauth_failed", "reset_requested", "reset_completed", "session_revoked"]))
      .orderBy(desc(authEvents.createdAt))
      .limit(50);

    return {
      database: {
        tablesWithoutRls: rlsRows.filter(row => !row.rowsecurity).map(row => row.tablename),
        tableCount: rlsRows.length,
        apiRolesPresent: roleRows.length > 0,
        apiGrants,
        appliedMigrations,
        repoMigrations: journal.entries.length,
      },
      configuration: {
        authBaseUrlSet: Boolean(ENV.authBaseUrl),
        allowedOriginSet: Boolean(ENV.allowedOrigin),
        emailConfigured: isEmailConfigured(),
        billingEnabled: isBillingEnabled(),
        storageConfigured: isS3Configured(),
        sentryConfigured: Boolean(process.env.SENTRY_DSN?.trim()),
        rateLimitsDisabled: process.env.RATE_LIMIT_DISABLED === "1",
        production: ENV.isProduction,
      },
      operators: { activeSuperadmins, activeStaff: staff.length, withoutPassword: staff.filter(row => !row.hasPassword).length },
      referenceViolations,
      alerts: {
        lockoutsLast24h: Number(lockouts?.n ?? 0),
        failedLoginsLast24h: Number(failures?.n ?? 0),
        writeImpersonationsLast7d: writeStarts.length,
        newIpOperatorLogins: newIpLogins,
      },
      events,
    };
  }),
});

export const adminToolsRouter = router({ users: usersRouter, sessions: sessionsRouter, audit: auditRouter, security: securityRouter });
