import express, { type Express, type Request, type Response } from "express";
import { EventName } from "@paddle/paddle-node-sdk";
import {
  applySubscriptionNotification,
  hasProcessedEvent,
  recordBillingEvent,
  type SubscriptionSnapshot,
} from "../billingService";
import { BILLING } from "./env";
import { getPaddle } from "./paddle";
import { logger } from "./logger";
import { captureError } from "./sentry";

export const PADDLE_WEBHOOK_PATH = "/api/billing/webhook";

const SUBSCRIPTION_EVENTS = new Set<string>([
  EventName.SubscriptionCreated,
  EventName.SubscriptionActivated,
  EventName.SubscriptionUpdated,
  EventName.SubscriptionCanceled,
  EventName.SubscriptionPaused,
  EventName.SubscriptionResumed,
  EventName.SubscriptionPastDue,
  EventName.SubscriptionTrialing,
]);

/**
 * Registers the Paddle webhook receiver.
 *
 * MUST be mounted before the global express.json() body parser: Paddle signs
 * the exact bytes it sent, so the signature can only be checked against the
 * raw body. Once express.json() has parsed and discarded those bytes,
 * re-serialising the object produces different bytes and every signature
 * check fails.
 */
export function registerPaddleWebhook(app: Express) {
  app.post(
    PADDLE_WEBHOOK_PATH,
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req: Request, res: Response) => {
      const signature = req.headers["paddle-signature"];
      const paddle = getPaddle();

      if (!paddle || !BILLING.paddleWebhookSecret) {
        logger.warn("Received a Paddle webhook but billing is not configured");
        res.status(503).json({ error: "Billing is not configured" });
        return;
      }
      if (typeof signature !== "string" || !signature) {
        res.status(400).json({ error: "Missing Paddle-Signature header" });
        return;
      }
      if (!Buffer.isBuffer(req.body)) {
        // Guards against a future refactor remounting this route after a JSON
        // body parser, which would silently break signature verification.
        logger.error(
          "Paddle webhook body was parsed before signature verification"
        );
        res.status(500).json({ error: "Webhook misconfigured" });
        return;
      }

      const rawBody = req.body.toString("utf8");

      let event;
      try {
        // unmarshal verifies the HMAC-SHA256 signature and parses in one step;
        // it throws when the signature does not match.
        event = await paddle.webhooks.unmarshal(
          rawBody,
          BILLING.paddleWebhookSecret,
          signature
        );
      } catch (error) {
        logger.warn(
          { err: error },
          "Rejected a Paddle webhook with an invalid signature"
        );
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
      if (!event) {
        res.status(400).json({ error: "Unreadable webhook payload" });
        return;
      }

      try {
        // Returning 200 for an already-seen event stops Paddle retrying it.
        if (await hasProcessedEvent(event.eventId)) {
          res.status(200).json({ ok: true, duplicate: true });
          return;
        }

        const occurredAt = new Date(event.occurredAt);
        let organizationId: number | null = null;
        let subscriptionId: string | null = null;

        if (SUBSCRIPTION_EVENTS.has(event.eventType)) {
          const subscription = event.data as SubscriptionSnapshot;
          subscriptionId = subscription.id;
          organizationId = await applySubscriptionNotification(
            subscription,
            occurredAt
          );
        } else {
          logger.debug(
            { eventType: event.eventType },
            "Ignoring unhandled Paddle event type"
          );
        }

        await recordBillingEvent({
          paddleEventId: event.eventId,
          eventType: event.eventType,
          organizationId,
          paddleSubscriptionId: subscriptionId,
          occurredAt,
          payload: event.data,
        });

        res.status(200).json({ ok: true });
      } catch (error) {
        // A non-2xx makes Paddle retry, which is what we want for a transient
        // failure such as the database being briefly unreachable.
        logger.error(
          { err: error, eventId: event.eventId },
          "Failed to process a Paddle webhook"
        );
        captureError(error);
        res.status(500).json({ error: "Failed to process webhook" });
      }
    }
  );
}
