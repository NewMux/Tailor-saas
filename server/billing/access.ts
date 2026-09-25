import type { Organization } from "../../drizzle/schema";

export type BillingAccess = "full" | "read_only";

export type BillingAccessReason =
  | "billing_disabled"
  | "exempt"
  | "active"
  | "trialing"
  | "trial_expired"
  | "past_due"
  | "paused"
  | "canceled";

type BillingFields = Pick<Organization, "subscriptionStatus" | "trialEndsAt" | "billingExempt">;

/**
 * Single source of truth for whether an organization may change data.
 *
 * Read-only (not locked out) is deliberate: a shop whose trial ended or
 * whose card failed can still sign in, look up customers and orders and
 * export its data; it just can't record new work until it pays.
 */
export function billingAccess(
  organization: BillingFields,
  now: Date,
  billingEnabled: boolean
): { access: BillingAccess; reason: BillingAccessReason } {
  if (!billingEnabled) return { access: "full", reason: "billing_disabled" };
  if (organization.billingExempt) return { access: "full", reason: "exempt" };
  switch (organization.subscriptionStatus) {
    case "active":
      return { access: "full", reason: "active" };
    case "trialing":
      return organization.trialEndsAt && organization.trialEndsAt.getTime() > now.getTime()
        ? { access: "full", reason: "trialing" }
        : { access: "read_only", reason: "trial_expired" };
    case "past_due":
      return { access: "read_only", reason: "past_due" };
    case "paused":
      return { access: "read_only", reason: "paused" };
    case "canceled":
      return { access: "read_only", reason: "canceled" };
  }
}
