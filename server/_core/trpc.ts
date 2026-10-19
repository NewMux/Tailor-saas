import {
  BILLING_READ_ONLY_ERR_MSG,
  IMPERSONATION_BLOCKED_ERR_MSG,
  IMPERSONATION_READ_ONLY_ERR_MSG,
  NOT_PLATFORM_STAFF_ERR_MSG,
  ORG_SUSPENDED_ERR_MSG,
  REAUTH_REQUIRED_ERR_MSG,
  UNAUTHED_ERR_MSG,
} from "@shared/const";
import { isDeniedWhileImpersonating, isMutationAllowedInWriteMode } from "./impersonationPolicy";
import { requestContext } from "./requestContext";
import { platformAudit } from "./platformAudit";
import { REAUTH_WINDOW_MS } from "./localAuth";
import { billingAccess } from "../billing/access";
import { isBillingEnabled } from "./env";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getOrganizationById, getPlatformStaffByUserId } from "../db";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireOrganizationFor = (options: { enforceBilling: boolean }) => t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (!ctx.user.organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account is not linked to an organization.",
    });
  }

  const { user } = ctx;
  const organizationId: number = ctx.user.organizationId;
  const organization = await getOrganizationById(organizationId);
  if (organization?.status === "suspended" && !ctx.impersonation) {
    throw new TRPCError({ code: "FORBIDDEN", message: ORG_SUSPENDED_ERR_MSG });
  }
  // Unpaid organizations are read-only: queries keep working (so the shop
  // can still look things up and export), mutations are refused. Platform
  // staff impersonating for support are not blocked.
  if (
    options.enforceBilling &&
    opts.type === "mutation" &&
    organization &&
    !ctx.impersonation &&
    billingAccess(organization, new Date(), isBillingEnabled()).access === "read_only"
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: BILLING_READ_ONLY_ERR_MSG });
  }

  if (ctx.impersonation) {
    const mode = ctx.impersonation.mode === "write" ? "write" : "readonly";
    if (isDeniedWhileImpersonating(opts.path)) {
      throw new TRPCError({ code: "FORBIDDEN", message: IMPERSONATION_BLOCKED_ERR_MSG });
    }
    if (opts.type === "mutation") {
      if (mode !== "write") {
        throw new TRPCError({ code: "FORBIDDEN", message: IMPERSONATION_READ_ONLY_ERR_MSG });
      }
      if (!isMutationAllowedInWriteMode(opts.path)) {
        throw new TRPCError({ code: "FORBIDDEN", message: IMPERSONATION_BLOCKED_ERR_MSG });
      }
      // Independent ledger of every change an operator makes as someone else.
      await platformAudit({
        actor: { id: ctx.impersonation.platformStaffUserId },
        action: "IMPERSONATED_MUTATION",
        targetType: "procedure",
        organizationId: ctx.user.organizationId,
        details: { path: opts.path, asUserId: ctx.user.id },
        req: ctx.req,
      });
    }
  }

  // Lets audit() record the real operator without every call site passing it.
  return requestContext.run({ impersonatedBy: ctx.impersonation?.platformStaffUserId ?? null, tenantScope: true }, () =>
    next({ ctx: { ...ctx, user, organizationId } })
  );
});

/**
 * Base procedure for every tenant-scoped ERP/POS route. Guarantees
 * ctx.organizationId is set so scopedDb() (server/_core/tenantDb.ts) always
 * has a non-null value to filter/stamp queries with.
 */
export const tenantProcedure = t.procedure.use(requireUser).use(requireOrganizationFor({ enforceBilling: true }));

/**
 * Tenant-scoped, but exempt from read-only billing enforcement. Only for the
 * billing routes themselves: an unpaid shop must still be able to open the
 * customer portal and pay.
 */
export const tenantBillingProcedure = t.procedure.use(requireUser).use(requireOrganizationFor({ enforceBilling: false }));

const requirePlatformStaff = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  // An impersonation session acts as the target *shop* user only. Without
  // this, impersonating someone who is also platform staff would hand the
  // session their operator powers (including starting new impersonations
  // attributed to them).
  if (ctx.impersonation) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  }
  const staff = await getPlatformStaffByUserId(ctx.user.id);
  if (!staff) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      platformRole: staff.role,
    },
  });
});

/** Base procedure for every cross-tenant operator (Tafsell staff) route. */
export const platformProcedure = t.procedure.use(requireUser).use(requirePlatformStaff);

const requireSuperadmin = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.platformRole !== "superadmin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/** For operator actions with real consequences: suspend/reactivate an org, grant/revoke platform staff, impersonate. */
export const superadminProcedure = platformProcedure.use(requireSuperadmin);

/** Throws unless the session confirmed its password in the last few minutes. */
export function assertRecentAuth(ctx: { session?: { reauthAt: Date | null } | null }) {
  const reauthAt = ctx.session?.reauthAt;
  if (!reauthAt || Date.now() - reauthAt.getTime() > REAUTH_WINDOW_MS) {
    throw new TRPCError({ code: "FORBIDDEN", message: REAUTH_REQUIRED_ERR_MSG });
  }
}

/** High-risk operator actions need a password confirmation from the last few minutes. */
const requireRecentAuth = t.middleware(async opts => {
  assertRecentAuth(opts.ctx);
  return opts.next();
});

/** Superadmin procedures with real consequences: staff changes, suspension, write-mode impersonation. */
export const highRiskProcedure = superadminProcedure.use(requireRecentAuth);
