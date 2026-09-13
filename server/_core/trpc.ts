import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { accessDeniedMessage } from "../billingEntitlement";
import { getBillingAccess } from "../billingService";
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

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      organizationId: ctx.user.organizationId,
    },
  });
});

/**
 * Enforces the paywall.
 *
 * Applied to tenantProcedure rather than to individual routes so that every
 * ERP/POS route - present and future - is covered by construction: a new
 * route cannot forget to check. Billing routes deliberately sit on
 * protectedProcedure instead, so a locked-out owner can still reach the
 * screen that lets them pay.
 *
 * This costs one primary-key lookup per request. That is deliberately not
 * cached: caching would leave a shop locked out for the cache lifetime after
 * they have already paid, which is a far worse failure than a cheap query.
 */
const requireActiveSubscription = t.middleware(async opts => {
  const { ctx, next } = opts;

  // Re-asserted rather than inherited: t.middleware types its context as the
  // base TrpcContext, so the narrowing done by requireUser/requireOrganization
  // has to be re-established here or downstream routes lose it.
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  const organizationId = ctx.organizationId ?? ctx.user.organizationId;
  if (!organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account is not linked to an organization.",
    });
  }

  const access = await getBillingAccess(organizationId);
  if (!access.allowed) {
    // PAYMENT_REQUIRED maps to HTTP 402, which the client uses to tell a
    // billing lockout apart from an ordinary permission error.
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: accessDeniedMessage(access.reason),
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user, organizationId } });
});

/**
 * Base procedure for every tenant-scoped ERP/POS route. Guarantees
 * ctx.organizationId is set so scopedDb() (server/_core/tenantDb.ts) always
 * has a non-null value to filter/stamp queries with, and that the
 * organization's subscription or trial is currently valid.
 */
export const tenantProcedure = t.procedure
  .use(requireUser)
  .use(requireOrganization)
  .use(requireActiveSubscription);

export const adminProcedure = t.procedure.use(
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
