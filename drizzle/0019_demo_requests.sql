-- "Book a demo" requests from the marketing site. Stored before the sales
-- notification email is sent, so a lead survives an email outage.
CREATE TABLE IF NOT EXISTS "demoRequests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"shopName" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(40),
	"message" text,
	"language" varchar(2) DEFAULT 'en' NOT NULL,
	"ip" varchar(64),
	"notifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demoRequests_createdAt_idx" ON "demoRequests" ("createdAt");--> statement-breakpoint

-- Same as every other table (see 0015_enable_rls): no policies, so the
-- Supabase Data API can neither read nor write it.
ALTER TABLE "demoRequests" ENABLE ROW LEVEL SECURITY;
