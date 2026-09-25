import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import { auditLogs, organizations, paddleWebhookEvents, type SubscriptionStatus } from "../../drizzle/schema";
import { getDb } from "../db";
import { ENV, isBillingEnabled } from "../_core/env";
import { logger } from "../_core/logger";
import { captureError } from "../_core/sentry";
import { verifyOrganizationSignature, verifyPaddleSignature } from "./paddle";

export const PADDLE_WEBHOOK_PATH = "/api/billing/paddle-webhook";

type PaddleSubscriptionData = {
  id: string;
  status: string;
  customer_id: string;
  custom_data?: { organizationId?: unknown; organizationSignature?: unknown } | null;
  current_billing_period?: { starts_at: string; ends_at: string } | null;
};

export type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: PaddleSubscriptionData;
};

export type ApplyResult =
  | { outcome: "applied"; organizationId: number; status: SubscriptionStatus }
  | { outcome: "duplicate" | "ignored_type" | "stale" | "unknown_organization" };

// Paddle's own "trialing" means a Paddle-side trial with a payment method on
// file. We run the no-card trial ourselves, so a Paddle subscription in
// trial counts as a paying subscription.
function mapStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    default:
      return null;
  }
}

/**
 * Applies one verified Paddle event. Idempotent (event ids are recorded)
 * and order-safe (events older than the last applied one are ignored),
 * since Paddle retries deliveries and does not guarantee ordering.
 */
export async function applyPaddleEvent(event: PaddleEvent): Promise<ApplyResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  if (!event.event_type.startsWith("subscription.")) return { outcome: "ignored_type" };
  const status = mapStatus(event.data.status);
  if (!status) return { outcome: "ignored_type" };
  const occurredAt = new Date(event.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) throw new Error(`Invalid occurred_at on ${event.event_id}`);

  return db.transaction(async tx => {
    const inserted = await tx
      .insert(paddleWebhookEvents)
      .values({ eventId: event.event_id, eventType: event.event_type })
      .onConflictDoNothing()
      .returning({ id: paddleWebhookEvents.id });
    if (inserted.length === 0) return { outcome: "duplicate" as const };

    let organization = (
      await tx.select().from(organizations).where(eq(organizations.paddleSubscriptionId, event.data.id)).limit(1).for("update")
    )[0];
    if (!organization) {
      const organizationId = Number(event.data.custom_data?.organizationId);
      if (Number.isInteger(organizationId) && organizationId > 0 && verifyOrganizationSignature(organizationId, event.data.custom_data?.organizationSignature)) {
        organization = (await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).for("update"))[0];
      }
    }
    if (!organization) {
      logger.warn({ eventId: event.event_id, subscriptionId: event.data.id }, "Paddle event for an unknown organization");
      return { outcome: "unknown_organization" as const };
    }
    // A shop that re-subscribes after cancelling gets a new subscription;
    // late events from the old one must not overwrite the new state.
    if (organization.paddleSubscriptionId && organization.paddleSubscriptionId !== event.data.id && organization.subscriptionStatus === "active" && status !== "active") {
      return { outcome: "stale" as const };
    }
    if (organization.billingEventAt && organization.billingEventAt.getTime() > occurredAt.getTime()) {
      return { outcome: "stale" as const };
    }

    const endsAt = event.data.current_billing_period?.ends_at ? new Date(event.data.current_billing_period.ends_at) : null;
    await tx
      .update(organizations)
      .set({
        subscriptionStatus: status,
        paddleCustomerId: event.data.customer_id,
        paddleSubscriptionId: event.data.id,
        currentPeriodEndsAt: endsAt,
        billingEventAt: occurredAt,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organization.id));
    if (organization.subscriptionStatus !== status) {
      await tx.insert(auditLogs).values({
        organizationId: organization.id,
        actorId: organization.ownerId,
        action: "BILLING_STATUS_CHANGED",
        entityType: "organization",
        entityId: organization.id,
        detailsJson: JSON.stringify({ from: organization.subscriptionStatus, to: status, paddleEventId: event.event_id }),
      });
    }
    return { outcome: "applied" as const, organizationId: organization.id, status };
  });
}

/**
 * Must be registered before express.json(): the signature is computed over
 * the exact raw bytes Paddle sent, which a parsed-and-reserialized body
 * would not reproduce.
 */
export function registerPaddleWebhook(app: Express) {
  app.post(PADDLE_WEBHOOK_PATH, express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    if (!isBillingEnabled()) {
      res.status(404).json({ error: "Billing is not configured" });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const signature = req.header("Paddle-Signature");
    if (!verifyPaddleSignature(rawBody, signature, ENV.paddleWebhookSecret)) {
      logger.warn("Rejected Paddle webhook with an invalid signature");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    try {
      const event = JSON.parse(rawBody) as PaddleEvent;
      const result = await applyPaddleEvent(event);
      logger.info({ eventId: event.event_id, eventType: event.event_type, ...result }, "Paddle webhook processed");
      res.json({ ok: true });
    } catch (err) {
      // A 5xx makes Paddle retry the delivery later.
      logger.error({ err }, "Paddle webhook processing failed");
      captureError(err);
      res.status(500).json({ error: "Processing failed" });
    }
  });
}
