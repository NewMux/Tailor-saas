-- Subscription billing (Paddle). Status lives directly on organizations:
-- there is exactly one subscription per organization, and every tenant
-- request already loads the organization row (requireOrganization in
-- server/_core/trpc.ts), so enforcement costs no extra query.
DO $$ BEGIN
 CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'paused', 'canceled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionStatus" "subscription_status" DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trialEndsAt" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billingExempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "paddleCustomerId" varchar(64);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" varchar(64);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "currentPeriodEndsAt" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billingEventAt" timestamp;--> statement-breakpoint

-- Organizations that existed before billing get a fresh 14-day trial from
-- the moment this migration runs, rather than being locked immediately.
UPDATE "organizations" SET "trialEndsAt" = now() + interval '14 days' WHERE "trialEndsAt" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_paddleSubscriptionId_unique" ON "organizations" ("paddleSubscriptionId");--> statement-breakpoint

-- Idempotency log for Paddle webhooks: Paddle retries deliveries, so each
-- event id is processed at most once.
CREATE TABLE IF NOT EXISTS "paddleWebhookEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventId" varchar(64) NOT NULL,
	"eventType" varchar(80) NOT NULL,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paddleWebhookEvents_eventId_unique" UNIQUE("eventId")
);
