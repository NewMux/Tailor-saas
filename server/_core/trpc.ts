import { NOT_ADMIN_ERR_MSG, NOT_PLATFORM_STAFF_ERR_MSG, ORG_SUSPENDED_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
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

const requireOrganization = t.middleware(async opts => {
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

  const organization = await getOrganizationById(ctx.user.organizationId);
  if (organization?.status === "suspended") {
    throw new TRPCError({ code: "FORBIDDEN", message: ORG_SUSPENDED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      organizationId: ctx.user.organizationId,
    },
  });
});

/**
 * Base procedure for every tenant-scoped ERP/POS route. Guarantees
 * ctx.organizationId is set so scopedDb() (server/_core/tenantDb.ts) always
 * has a non-null value to filter/stamp queries with.
 */
export const tenantProcedure = t.procedure.use(requireUser).use(requireOrganization);

/**
 * NOT platform-staff and NOT tenant-scoped: this only checks the legacy
 * global users.role flag, which createOrganizationWithOwner (server/db.ts)
 * sets to "admin" for every self-serve organization owner. Using this to
 * gate a platform-only feature would silently expose it to every tenant's
 * own owner. For cross-tenant/operator routes, use platformProcedure or
 * superadminProcedure instead.
 */
export const globalUserAdminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

const requirePlatformStaff = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
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

  if (ctx.platformRole !== "superadmin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  }

  return next({ ctx });
});

/** For operator actions with real consequences: suspend/reactivate an org, grant/revoke platform staff, impersonate. */
export const superadminProcedure = platformProcedure.use(requireSuperadmin);
