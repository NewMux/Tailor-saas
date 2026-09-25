import { TRPCError } from "@trpc/server";
import { getOrganizationById } from "../db";
import { billingAccess } from "../billing/access";
import { createPortalSessionUrl, getConfiguredPrice, signOrganizationId } from "../billing/paddle";
import { ENV, isBillingEnabled } from "../_core/env";
import { logger } from "../_core/logger";
import { publicProcedure, router, tenantBillingProcedure } from "../_core/trpc";
import { access, adminRoles } from "./shared";

async function isAdmin(userId: number, organizationId: number) {
  try {
    await access(userId, organizationId, adminRoles);
    return true;
  } catch {
    return false;
  }
}

async function loadOrganization(organizationId: number) {
  const organization = await getOrganizationById(organizationId);
  if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
  return organization;
}

export type PublicPrice = { amount: number; currency: string; interval: string; frequency: number } | null;

/** Price as configured in Paddle, for display only (Paddle charges it). */
export async function publicPrice(): Promise<PublicPrice> {
  if (!isBillingEnabled()) return null;
  try {
    const price = await getConfiguredPrice();
    return {
      // Paddle amounts are strings in the currency's lowest denomination.
      amount: Number(price.unit_price.amount),
      currency: price.unit_price.currency_code,
      interval: price.billing_cycle?.interval ?? "month",
      frequency: price.billing_cycle?.frequency ?? 1,
    };
  } catch (err) {
    logger.error({ err }, "Unable to load the Paddle price");
    return null;
  }
}

// Every procedure here uses tenantBillingProcedure, not tenantProcedure, so
// an organization that is read-only for non-payment can still reach them.
export const billingRouter = router({
  status: tenantBillingProcedure.query(async ({ ctx }) => {
    const organization = await loadOrganization(ctx.organizationId);
    const now = new Date();
    const { access: accessLevel, reason } = billingAccess(organization, now, isBillingEnabled());
    const trialDaysLeft =
      organization.subscriptionStatus === "trialing" && organization.trialEndsAt
        ? Math.max(0, Math.ceil((organization.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        : null;
    return {
      billingEnabled: isBillingEnabled(),
      access: accessLevel,
      reason,
      subscriptionStatus: organization.subscriptionStatus,
      billingExempt: organization.billingExempt,
      trialEndsAt: organization.trialEndsAt,
      trialDaysLeft,
      currentPeriodEndsAt: organization.currentPeriodEndsAt,
      hasSubscription: Boolean(organization.paddleSubscriptionId),
      canManage: await isAdmin(ctx.user.id, ctx.organizationId),
      price: await publicPrice(),
    };
  }),

  checkoutConfig: tenantBillingProcedure.mutation(async ({ ctx }) => {
    if (!isBillingEnabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing is not configured." });
    await access(ctx.user.id, ctx.organizationId, adminRoles);
    const organization = await loadOrganization(ctx.organizationId);
    if (organization.subscriptionStatus === "active" && organization.paddleSubscriptionId) {
      throw new TRPCError({ code: "CONFLICT", message: "This shop already has an active subscription. Use Manage billing instead." });
    }
    return {
      environment: ENV.paddleEnvironment,
      clientToken: ENV.paddleClientToken,
      priceId: ENV.paddlePriceId,
      customerEmail: ctx.user.email ?? undefined,
      customData: {
        organizationId: String(organization.id),
        organizationSignature: signOrganizationId(organization.id),
      },
    };
  }),

  portalUrl: tenantBillingProcedure.mutation(async ({ ctx }) => {
    if (!isBillingEnabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing is not configured." });
    await access(ctx.user.id, ctx.organizationId, adminRoles);
    const organization = await loadOrganization(ctx.organizationId);
    if (!organization.paddleCustomerId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There is no subscription to manage yet." });
    }
    try {
      return { url: await createPortalSessionUrl(organization.paddleCustomerId, organization.paddleSubscriptionId) };
    } catch (err) {
      logger.error({ err, organizationId: organization.id }, "Unable to create a Paddle portal session");
      throw new TRPCError({ code: "BAD_GATEWAY", message: "The billing portal is unavailable right now. Please try again shortly." });
    }
  }),
});

/** Unauthenticated: used by the public pricing page and the sign-up form. */
export const publicBillingRouter = router({
  plan: publicProcedure.query(async () => ({
    billingEnabled: isBillingEnabled(),
    trialDays: ENV.trialDays,
    price: await publicPrice(),
  })),
});
