import type { Organization } from "../drizzle/schema";

export type BillingSnapshot = Pick<
  Organization,
  | "subscriptionStatus"
  | "trialEndsAt"
  | "currentPeriodEndsAt"
  | "paddleSubscriptionId"
>;

export type AccessReason =
  | "billing_disabled"
  | "subscribed"
  | "trialing"
  | "grace_period"
  | "trial_expired"
  | "payment_failed"
  | "subscription_paused"
  | "subscription_canceled";

export type BillingAccess = {
  allowed: boolean;
  reason: AccessReason;
  /** Whole days left before access is lost; null when nothing is counting down. */
  daysRemaining: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `now` until `until`, rounded up, floored at 0. */
function daysUntil(until: Date | null, now: Date): number | null {
  if (!until) return null;
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / MS_PER_DAY));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Decides whether an organization may use the ERP right now.
 *
 * Deliberately a pure function of (organization row, clock, config) with no
 * database or network access: this is the single place the paywall decision
 * is made, so it has to be exhaustively testable without a Paddle account.
 *
 * `billingConfigured` is false when this deployment has no Paddle credentials.
 * Access is then always granted - a deployment nobody can pay for must not
 * lock itself, which is also what keeps local dev and CI usable.
 */
export function evaluateBillingAccess(
  organization: BillingSnapshot,
  options: { now?: Date; billingConfigured: boolean; gracePeriodDays: number }
): BillingAccess {
  const now = options.now ?? new Date();

  if (!options.billingConfigured) {
    return { allowed: true, reason: "billing_disabled", daysRemaining: null };
  }

  switch (organization.subscriptionStatus) {
    case "active":
      return {
        allowed: true,
        reason: "subscribed",
        daysRemaining: daysUntil(organization.currentPeriodEndsAt, now),
      };

    case "trialing": {
      // A Paddle-side trial (the card is already captured) is tracked by the
      // subscription itself, so trust the subscription rather than the local
      // trial clock once one exists.
      if (organization.paddleSubscriptionId) {
        return {
          allowed: true,
          reason: "subscribed",
          daysRemaining: daysUntil(organization.currentPeriodEndsAt, now),
        };
      }
      const trialEndsAt = organization.trialEndsAt;
      if (trialEndsAt && trialEndsAt.getTime() > now.getTime()) {
        return {
          allowed: true,
          reason: "trialing",
          daysRemaining: daysUntil(trialEndsAt, now),
        };
      }
      return { allowed: false, reason: "trial_expired", daysRemaining: 0 };
    }

    case "past_due": {
      // Paddle retries a failed renewal over several days. Keep the shop
      // open for a grace window measured from the end of the period that
      // was actually paid for, rather than cutting service off instantly.
      const paidUntil = organization.currentPeriodEndsAt;
      const graceEndsAt = paidUntil
        ? addDays(paidUntil, options.gracePeriodDays)
        : null;
      if (graceEndsAt && graceEndsAt.getTime() > now.getTime()) {
        return {
          allowed: true,
          reason: "grace_period",
          daysRemaining: daysUntil(graceEndsAt, now),
        };
      }
      return { allowed: false, reason: "payment_failed", daysRemaining: 0 };
    }

    case "paused":
      return {
        allowed: false,
        reason: "subscription_paused",
        daysRemaining: 0,
      };

    case "canceled": {
      // A cancellation stays served until the period already paid for ends.
      const paidUntil = organization.currentPeriodEndsAt;
      if (paidUntil && paidUntil.getTime() > now.getTime()) {
        return {
          allowed: true,
          reason: "subscribed",
          daysRemaining: daysUntil(paidUntil, now),
        };
      }
      return {
        allowed: false,
        reason: "subscription_canceled",
        daysRemaining: 0,
      };
    }

    case "expired":
      return { allowed: false, reason: "trial_expired", daysRemaining: 0 };

    default:
      // Fail closed on an unrecognised status rather than handing out access.
      return {
        allowed: false,
        reason: "subscription_canceled",
        daysRemaining: 0,
      };
  }
}

/** Message shown on the paywall for each blocking reason. */
export const ACCESS_DENIED_MESSAGES: Record<string, string> = {
  trial_expired:
    "Your free trial has ended. Subscribe to continue using your workspace.",
  payment_failed:
    "We could not take your last payment. Update your payment method to restore access.",
  subscription_paused:
    "Your subscription is paused. Resume it to continue using your workspace.",
  subscription_canceled:
    "Your subscription has ended. Resubscribe to continue using your workspace.",
};

export function accessDeniedMessage(reason: AccessReason): string {
  return (
    ACCESS_DENIED_MESSAGES[reason] ?? "A subscription is required to continue."
  );
}
