-- Operator (platform staff) security: an audit trail that is not tied to one
-- shop, a log of sign-in events for lockout and review, attribution of tenant
-- changes made while impersonating, and the per-session state that read-only
-- impersonation and password re-entry need.

CREATE TABLE IF NOT EXISTS "platformAuditLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorId" integer,
	"actorEmail" varchar(320),
	"action" varchar(100) NOT NULL,
	"targetType" varchar(80) NOT NULL,
	"targetId" integer,
	"organizationId" integer,
	"detailsJson" text,
	"source" varchar(20) DEFAULT 'app' NOT NULL,
	"ip" varchar(64),
	"userAgent" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platformAuditLogs_createdAt_idx" ON "platformAuditLogs" ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platformAuditLogs_organizationId_idx" ON "platformAuditLogs" ("organizationId");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "authEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(40) NOT NULL,
	"userId" integer,
	"emailHash" varchar(64),
	"ip" varchar(64),
	"userAgent" varchar(255),
	"detailsJson" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authEvents_emailHash_createdAt_idx" ON "authEvents" ("emailHash", "createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authEvents_ip_createdAt_idx" ON "authEvents" ("ip", "createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authEvents_userId_createdAt_idx" ON "authEvents" ("userId", "createdAt");--> statement-breakpoint

ALTER TABLE "auditLogs" ADD COLUMN IF NOT EXISTS "impersonatedBy" integer;--> statement-breakpoint
ALTER TABLE "authSessions" ADD COLUMN IF NOT EXISTS "impersonationMode" varchar(10);--> statement-breakpoint
ALTER TABLE "authSessions" ADD COLUMN IF NOT EXISTS "reauthAt" timestamp;--> statement-breakpoint

-- Every table in "public" keeps row-level security enabled (see 0015).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
