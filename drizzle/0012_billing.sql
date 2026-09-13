-- Self-serve billing: a 14-day trial on signup, then a Paddle subscription.
--
-- New organizations default to "trialing" (server/db.ts stamps trialEndsAt in
-- the same transaction that creates them). Every organization that exists at
-- the time this migration runs predates billing entirely, so the UPDATE below
-- grandfathers those rows to "active" - upgrading a running deployment must
-- never lock an existing shop out of its own data behind a paywall.
CREATE TYPE "subscription_status" AS ENUM ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscriptionStatus" "subscription_status" DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trialEndsAt" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paddleCustomerId" varchar(80);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paddleSubscriptionId" varchar(80);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paddlePriceId" varchar(80);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "currentPeriodEndsAt" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscriptionUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_paddleSubscriptionId_unique" UNIQUE("paddleSubscriptionId");--> statement-breakpoint
UPDATE "organizations" SET "subscriptionStatus" = 'active';--> statement-breakpoint

CREATE TABLE "billingEvents" (
  "id" serial PRIMARY KEY NOT NULL,
  "paddleEventId" varchar(80) NOT NULL,
  "eventType" varchar(80) NOT NULL,
  "organizationId" integer,
  "paddleSubscriptionId" varchar(80),
  "occurredAt" timestamp NOT NULL,
  "receivedAt" timestamp DEFAULT now() NOT NULL,
  "payloadJson" jsonb NOT NULL,
  CONSTRAINT "billingEvents_paddleEventId_unique" UNIQUE("paddleEventId")
);--> statement-breakpoint
ALTER TABLE "billingEvents" ADD CONSTRAINT "billingEvents_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billingEvents_subscription_idx" ON "billingEvents" ("paddleSubscriptionId");
