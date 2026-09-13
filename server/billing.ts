import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BILLING, isBillingConfigured } from "./_core/env";
import { getPaddle } from "./_core/paddle";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { logger } from "./_core/logger";
import { evaluateBillingAccess } from "./billingEntitlement";
import {
  applySubscriptionNotification,
  getOrganizationById,
} from "./billingService";

/** Resolves the caller's organization, or fails if their account has none. */
async function requireOrganization(organizationId: number | null) {
  if (!organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account is not linked to an organization.",
    });
  }
  const organization = await getOrganizationById(organizationId);
  if (!organization) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Organization not found.",
    });
  }
  return organization;
}

/**
 * Billing routes deliberately use protectedProcedure rather than
 * tenantProcedure: tenantProcedure is what enforces the paywall, so building
 * the paywall screen on top of it would lock the user out of the very page
 * they need in order to pay.
 */
export const billingRouter = router({
  /**
   * Plan details for the public landing page, readable without a session.
   * Exposes only the publishable client token and price id so the page can
   * ask Paddle for a price localized to the visitor's country - a GCC
   * visitor sees SAR/AED rather than a foreign currency. displayPrice is the
   * fallback used when that lookup cannot run.
   */
  publicPlan: publicProcedure.query(() => ({
    configured: isBillingConfigured(),
    clientToken: BILLING.paddleClientToken,
    priceId: BILLING.paddlePriceId,
    environment: BILLING.paddleEnvironment,
    trialDays: BILLING.trialDays,
    displayPrice: BILLING.displayPrice,
    displayCurrency: BILLING.displayCurrency,
  })),

  /**
   * Public Paddle settings for the browser. Served at runtime instead of
   * being baked in via VITE_* build args, so a deployment can move between
   * Paddle sandbox and live with an environment change and a restart.
   * Only the publishable client token is exposed - never the API key.
   */
  config: protectedProcedure.query(() => ({
    configured: isBillingConfigured(),
    clientToken: BILLING.paddleClientToken,
    priceId: BILLING.paddlePriceId,
    environment: BILLING.paddleEnvironment,
    trialDays: BILLING.trialDays,
  })),

  /** Subscription state plus the current paywall decision. */
  status: protectedProcedure.query(async opts => {
    const organization = await requireOrganization(
      opts.ctx.user.organizationId
    );
    const access = evaluateBillingAccess(organization, {
      billingConfigured: isBillingConfigured(),
      gracePeriodDays: BILLING.gracePeriodDays,
    });
    return {
      organizationName: organization.name,
      subscriptionStatus: organization.subscriptionStatus,
      trialEndsAt: organization.trialEndsAt,
      currentPeriodEndsAt: organization.currentPeriodEndsAt,
      hasSubscription: Boolean(organization.paddleSubscriptionId),
      access,
    };
  }),

  /**
   * Data needed to open a Paddle checkout. organizationId is echoed back so
   * the client can attach it as customData - that is what lets the webhook
   * match the resulting subscription to this organization.
   */
  checkout: protectedProcedure.query(async opts => {
    const organization = await requireOrganization(
      opts.ctx.user.organizationId
    );
    if (!isBillingConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Billing is not configured on this deployment.",
      });
    }
    return {
      priceId: BILLING.paddlePriceId,
      organizationId: organization.id,
      customerEmail: opts.ctx.user.email ?? undefined,
      paddleCustomerId: organization.paddleCustomerId ?? undefined,
    };
  }),

  /**
   * One-time Paddle customer-portal link for managing payment details or
   * cancelling. Generated on demand because these URLs are short-lived.
   */
  portalSession: protectedProcedure.mutation(async opts => {
    const organization = await requireOrganization(
      opts.ctx.user.organizationId
    );
    const paddle = getPaddle();
    if (!paddle || !organization.paddleCustomerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There is no active subscription to manage yet.",
      });
    }
    try {
      const session = await paddle.customerPortalSessions.create(
        organization.paddleCustomerId,
        organization.paddleSubscriptionId
          ? [organization.paddleSubscriptionId]
          : []
      );
      const subscriptionUrls = session.urls.subscriptions[0];
      return {
        overviewUrl: session.urls.general.overview,
        cancelUrl: subscriptionUrls?.cancelSubscription ?? null,
        updatePaymentMethodUrl:
          subscriptionUrls?.updateSubscriptionPaymentMethod ?? null,
      };
    } catch (error) {
      logger.error(
        { err: error, organizationId: organization.id },
        "Failed to create a Paddle customer portal session"
      );
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not open the billing portal. Please try again.",
      });
    }
  }),

  /**
   * Pulls the live subscription state from Paddle on demand. The webhook is
   * the normal path; this exists so the UI can refresh immediately after a
   * checkout completes instead of waiting for webhook delivery.
   */
  refresh: protectedProcedure.input(z.void()).mutation(async opts => {
    const organization = await requireOrganization(
      opts.ctx.user.organizationId
    );
    const paddle = getPaddle();
    if (!paddle || !organization.paddleSubscriptionId) {
      return { refreshed: false };
    }
    try {
      const subscription = await paddle.subscriptions.get(
        organization.paddleSubscriptionId
      );
      await applySubscriptionNotification(subscription, new Date());
      return { refreshed: true };
    } catch (error) {
      logger.error(
        { err: error, organizationId: organization.id },
        "Failed to refresh subscription from Paddle"
      );
      return { refreshed: false };
    }
  }),
});
