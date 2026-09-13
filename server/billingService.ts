import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import {
  billingEvents,
  organizations,
  type Organization,
} from "../drizzle/schema";
import { getDb } from "./db";
import { BILLING, isBillingConfigured } from "./_core/env";
import { logger } from "./_core/logger";
import {
  evaluateBillingAccess,
  type BillingAccess,
} from "./billingEntitlement";

/**
 * The subset of a Paddle subscription this app actually stores. Declared
 * structurally rather than as the SDK's SubscriptionNotification class so
 * that both webhook notifications and API responses (which carry the same
 * fields but are different classes) can be passed in, and so tests can build
 * one as a plain object.
 */
export type SubscriptionSnapshot = {
  id: string;
  status: string;
  customerId: string;
  customData?: unknown;
  items: ReadonlyArray<{ price?: { id?: string | null } | null }>;
  currentBillingPeriod?: { endsAt?: string | null } | null;
};

export async function getOrganizationById(
  organizationId: number
): Promise<Organization | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  return (
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
  )[0];
}

/** Current paywall decision for an organization, read straight from its row. */
export async function getBillingAccess(
  organizationId: number
): Promise<BillingAccess> {
  // Short-circuit before touching the database: a deployment with no Paddle
  // credentials never paywalls, so there is nothing to look up. This is also
  // what keeps the test suite and local dev free of billing queries.
  if (!isBillingConfigured()) {
    return { allowed: true, reason: "billing_disabled", daysRemaining: null };
  }

  const organization = await getOrganizationById(organizationId);
  if (!organization) {
    return {
      allowed: false,
      reason: "subscription_canceled",
      daysRemaining: 0,
    };
  }
  return evaluateBillingAccess(organization, {
    billingConfigured: isBillingConfigured(),
    gracePeriodDays: BILLING.gracePeriodDays,
  });
}

/**
 * Paddle's subscription statuses map 1:1 onto ours. The local-only "expired"
 * status is never produced by a webhook - it is only reached by a trial
 * running out, which has no Paddle subscription behind it at all.
 */
function mapSubscriptionStatus(
  status: string
): Organization["subscriptionStatus"] {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "paused":
    case "canceled":
      return status;
    default:
      logger.warn(
        { status },
        "Unrecognised Paddle subscription status; treating as past_due"
      );
      return "past_due";
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Finds the organization a subscription belongs to.
 *
 * customData.organizationId is the authoritative link and is set when the
 * checkout is opened (client/src/pages/Billing.tsx). The lookups by Paddle
 * subscription/customer id are fallbacks for later events on a subscription
 * that has already been linked once, which covers subscriptions created
 * outside the app - for example from the Paddle dashboard.
 */
async function resolveOrganizationId(
  subscription: SubscriptionSnapshot
): Promise<number | null> {
  const custom = subscription.customData as Record<string, unknown> | null;
  const raw = custom?.organizationId;
  const fromCustomData =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (Number.isInteger(fromCustomData) && fromCustomData > 0)
    return fromCustomData;

  const db = await getDb();
  if (!db) return null;

  const bySubscription = (
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.paddleSubscriptionId, subscription.id))
      .limit(1)
  )[0];
  if (bySubscription) return bySubscription.id;

  const byCustomer = (
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.paddleCustomerId, subscription.customerId))
      .limit(1)
  )[0];
  return byCustomer?.id ?? null;
}

/**
 * Writes a subscription notification onto the owning organization.
 *
 * Paddle does not guarantee webhook ordering, so an older event must never
 * overwrite a newer one: the update is skipped when the row already carries a
 * subscriptionUpdatedAt at or after this event's occurredAt. Without that,
 * a delayed subscription.updated could resurrect a cancelled subscription.
 */
export async function applySubscriptionNotification(
  subscription: SubscriptionSnapshot,
  occurredAt: Date
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const organizationId = await resolveOrganizationId(subscription);
  if (!organizationId) {
    logger.warn(
      { subscriptionId: subscription.id },
      "Paddle subscription could not be matched to an organization"
    );
    return null;
  }

  const existing = await getOrganizationById(organizationId);
  if (!existing) {
    logger.warn(
      { organizationId, subscriptionId: subscription.id },
      "Paddle webhook referenced a missing organization"
    );
    return null;
  }
  if (
    existing.subscriptionUpdatedAt &&
    existing.subscriptionUpdatedAt.getTime() >= occurredAt.getTime()
  ) {
    logger.info(
      { organizationId, subscriptionId: subscription.id },
      "Skipping out-of-order Paddle subscription event"
    );
    return organizationId;
  }

  await db
    .update(organizations)
    .set({
      subscriptionStatus: mapSubscriptionStatus(subscription.status),
      paddleSubscriptionId: subscription.id,
      paddleCustomerId: subscription.customerId,
      paddlePriceId: subscription.items[0]?.price?.id ?? existing.paddlePriceId,
      currentPeriodEndsAt:
        parseDate(subscription.currentBillingPeriod?.endsAt) ??
        existing.currentPeriodEndsAt,
      subscriptionUpdatedAt: occurredAt,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));

  logger.info(
    {
      organizationId,
      subscriptionId: subscription.id,
      status: subscription.status,
    },
    "Applied Paddle subscription update"
  );
  return organizationId;
}

/**
 * Records that an event has been handled. Returns false when the event id has
 * been seen before, which is how redelivery is made harmless: Paddle retries
 * every non-2xx response, so duplicates are routine rather than exceptional.
 */
export async function recordBillingEvent(input: {
  paddleEventId: string;
  eventType: string;
  organizationId: number | null;
  paddleSubscriptionId: string | null;
  occurredAt: Date;
  payload: unknown;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const inserted = await db
    .insert(billingEvents)
    .values({
      paddleEventId: input.paddleEventId,
      eventType: input.eventType,
      organizationId: input.organizationId,
      paddleSubscriptionId: input.paddleSubscriptionId,
      occurredAt: input.occurredAt,
      payloadJson: input.payload as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: billingEvents.paddleEventId })
    .returning({ id: billingEvents.id });
  return inserted.length > 0;
}

/** True when this event id has already been processed. */
export async function hasProcessedEvent(
  paddleEventId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = (
    await db
      .select({ id: billingEvents.id })
      .from(billingEvents)
      .where(eq(billingEvents.paddleEventId, paddleEventId))
      .limit(1)
  )[0];
  return Boolean(existing);
}

/**
 * Moves organizations whose trial has run out from "trialing" to "expired".
 *
 * This is only bookkeeping so the status column reads truthfully in the admin
 * UI - it is NOT what enforces the paywall. evaluateBillingAccess compares
 * trialEndsAt against the clock on every request, so access ends the moment
 * the trial does whether or not this has run.
 */
export async function expireFinishedTrials(now = new Date()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const expired = await db
    .update(organizations)
    .set({ subscriptionStatus: "expired", updatedAt: now })
    .where(
      and(
        eq(organizations.subscriptionStatus, "trialing"),
        isNotNull(organizations.trialEndsAt),
        lt(organizations.trialEndsAt, now),
        // A Paddle-side trial (card already captured) is driven by
        // subscription webhooks, not by the local trial clock.
        isNull(organizations.paddleSubscriptionId)
      )
    )
    .returning({ id: organizations.id });
  return expired.length;
}
